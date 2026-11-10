"""Deep-model bake-off harness.

  python tests/bakeoff.py run <model> <labels> [results.json]   -> spans/<model>__<labels>.json
  python tests/bakeoff.py grade <spansfile> <threshold> [results.json]
  python tests/bakeoff.py inject <spansfile> <threshold> <out.json> [results.json]

Feeds each candidate the same pieces the app's deep-check worker would (a port of
splitSentences in deep-check-worker.mjs, one sentence per call), with the app's labels.
"""
import json, os, re, sys, time
from pathlib import Path

HERE = Path.cwd()          # models in ./m/<name>, spans written to ./spans
REPO = Path(__file__).resolve().parents[1]
DEFAULT_RESULTS = REPO / "tests" / "results" / "base.json"   # any bench.mjs output: it supplies the record texts

APP_LABELS = [
    'person', 'health condition', 'disability', 'medication', 'assistive device',
    'family relationship', 'religious group', 'company', 'sports team or club',
    'school', 'government benefit',
    'hobby or personal interest', 'sport', 'career interest',
]
# GLiNER2-PII's own label names for the one type it shares with the app, added to the app's list
G2_NATIVE = APP_LABELS + ['full_name', 'first_name', 'last_name']
NATIVE_TO_APP = {'full_name': 'person', 'first_name': 'person', 'last_name': 'person'}
LABEL_SETS = {'app': APP_LABELS, 'native': G2_NATIVE}

MODELS = {
    'kedge': ('gliner', 'm/kedge'), 'ksmall': ('gliner', 'm/ksmall'), 'kbase': ('gliner', 'm/kbase'),
    'cur': ('gliner', 'm/cur'),
    # the ONNX builds a browser would actually load
    'kedge_fp16': ('gliner', 'm/kedge'), 'ksmall_fp16': ('gliner', 'm/ksmall'), 'kbase_fp16': ('gliner', 'm/kbase'),
    'kedge_q8': ('gliner', 'm/kedge'), 'ksmall_q8': ('gliner', 'm/ksmall'), 'kbase_q8': ('gliner', 'm/kbase'),
    'g2pii': ('gliner2', 'm/g2pii'), 'g2base': ('gliner2', 'm/g2base'),
}
MIN_T = 0.2          # predict down to here; grade/inject filter upward (equivalent under flat NER)
RE_SENT = re.compile(r'[^.!?\n]+[.!?\n]+|[^.!?\n]+\Z')


def u16len(s):
    return len(s.encode('utf-16-le')) // 2


def split_sentences(text):
    """Port of splitSentences(); offsets are Python code-point offsets."""
    out = []
    for m in RE_SENT.finditer(text):
        s, start = m.group(0), m.start()
        while u16len(s) > 400:
            i = s.rfind(' ', 0, 301)
            cut = i if i > 50 else 300
            out.append((s[:cut], start))
            start += cut
            s = s[cut:]
        if len(s.strip()) > 1:
            out.append((s, start))
    return [(s, st) for s, st in out if sum(ch.isalpha() for ch in s) >= 3]


def load_papers(path):
    r = json.load(open(path, encoding='utf-8'))
    return [(p['name'], p['text']) for p in r['papers']], r


def run(model_key, labels_key, results):
    kind, mdir = MODELS[model_key]
    labels = LABEL_SETS[labels_key]
    papers, _ = load_papers(results)
    pieces = []
    seen = set()
    for _, text in papers:
        for s, _ in split_sentences(text):
            if s not in seen:
                seen.add(s)
                pieces.append(s)
    print(f'{model_key}/{labels_key}: {len(pieces)} unique pieces from {len(papers)} papers', flush=True)
    import torch
    torch.set_num_threads(8)
    t0 = time.time()
    out = {}
    if kind == 'gliner':
        from gliner import GLiNER
        kw = {}
        if model_key == 'cur' or model_key.endswith('_fp16') or model_key.endswith('_q8'):
            import onnxruntime as ort
            so = ort.SessionOptions()
            # full optimization trips a LayerNorm-fusion bug on fp16 graphs
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
            so.intra_op_num_threads = 8
            onnx_file = 'onnx/model_quint8.onnx' if model_key.endswith('_q8') else 'onnx/model_fp16.onnx'
            kw = dict(load_onnx_model=True, load_tokenizer=True, onnx_model_file=onnx_file, session_options=so)
        model = GLiNER.from_pretrained(str(HERE / mdir), local_files_only=True, **kw)
        if hasattr(model, 'eval'):
            model.eval()
        tload = time.time() - t0
        t1 = time.time()
        B = 16
        for i in range(0, len(pieces), B):
            chunk = pieces[i:i + B]
            res = model.inference(chunk, labels, threshold=MIN_T, flat_ner=True, batch_size=B) if hasattr(model, 'inference') \
                else model.batch_predict_entities(chunk, labels, threshold=MIN_T, flat_ner=True)
            for s, ents in zip(chunk, res):
                out[s] = [dict(label=e['label'], text=e['text'], start=e['start'], end=e['end'], score=float(e['score'])) for e in ents]
            if i % 320 == 0:
                print(f'  {i}/{len(pieces)}  {time.time() - t1:.0f}s', flush=True)
    else:
        from gliner2 import GLiNER2
        model = GLiNER2.from_pretrained(str(HERE / mdir))
        tload = time.time() - t0
        t1 = time.time()
        B = 16
        for i in range(0, len(pieces), B):
            chunk = pieces[i:i + B]
            res = model.batch_extract_entities(chunk, labels, batch_size=B, threshold=MIN_T, include_confidence=True, include_spans=True)
            for s, r in zip(chunk, res):
                ents = []
                for lab, items in (r.get('entities', r) or {}).items():
                    for it in items:
                        ents.append(dict(label=lab, text=it['text'], start=it['start'], end=it['end'], score=float(it['confidence'])))
                out[s] = sorted(ents, key=lambda e: e['start'])
            if i % 320 == 0:
                print(f'  {i}/{len(pieces)}  {time.time() - t1:.0f}s', flush=True)
    secs = time.time() - t1
    (HERE / 'spans').mkdir(exist_ok=True)
    dest = HERE / 'spans' / f'{model_key}__{labels_key}.json'
    json.dump(dict(model=model_key, labels=labels, min_t=MIN_T, load_secs=tload, infer_secs=secs, pieces=out), open(dest, 'w', encoding='utf-8'))
    n = sum(len(v) for v in out.values())
    print(f'  done: load {tload:.0f}s, infer {secs:.0f}s ({1000 * secs / len(pieces):.0f} ms/piece), {n} spans >= {MIN_T} -> {dest.name}', flush=True)


def flat(spans):
    """Greedy non-overlapping pick by score (GLiNER2 can return overlaps across labels)."""
    keep = []
    for s in sorted(spans, key=lambda e: -e['score']):
        if all(s['end'] <= k['start'] or s['start'] >= k['end'] for k in keep):
            keep.append(s)
    return sorted(keep, key=lambda e: e['start'])


def doc_spans(text, pieces_map, thr):
    """Absolute spans for one document, in UTF-16 offsets like the worker's."""
    spans = []
    for s, st in split_sentences(text):
        for e in flat([x for x in pieces_map.get(s, []) if x['score'] >= thr]):
            a, b = st + e['start'], st + e['end']
            spans.append(dict(label=NATIVE_TO_APP.get(e['label'], e['label']), text=e['text'],
                              start=u16len(text[:a]), end=u16len(text[:b]), score=e['score'], _a=a, _b=b))
    return spans


def load_keys():
    keys = {}
    for setname in ['roberts', 'tuning', 'heldout', 'fresh', 'fresh2']:
        recs = json.load(open(REPO / 'tests' / 'keys' / f'{setname}.json', encoding='utf-8'))
        man = json.load(open(REPO / 'tests' / 'files' / setname / 'manifest.json', encoding='utf-8'))
        for m in man:
            k = next((r for r in recs if r['key'] == m['key']), None)
            if k:
                keys[m['file']] = (setname, k)
    return keys


def occurrences(text, needle):
    i = text.find(needle)
    while i >= 0:
        yield i, i + len(needle)
        i = text.find(needle, i + 1)


def grade(spansfile, thr, results):
    data = json.load(open(spansfile, encoding='utf-8'))
    papers, _ = load_papers(results)
    keys = load_keys()
    tot = dict(id=0, id_hit=0, quasi=0, quasi_hit=0, keep=0, keep_hit=0, spans=0)
    per_set = {}
    for name, text in papers:
        if name not in keys:
            continue
        setname, k = keys[name]
        sp = doc_spans(text, data['pieces'], thr)
        covered = [False] * len(text)
        for s in sp:
            for i in range(s['_a'], s['_b']):
                covered[i] = True
        ps = per_set.setdefault(setname, dict(id=0, id_hit=0, quasi=0, quasi_hit=0, keep=0, keep_hit=0, spans=0))
        ps['spans'] += len(sp)

        def items(field):
            for it in k.get(field, []) or []:
                yield it['text'] if isinstance(it, dict) else it
        for field, tag in (('identifiers', 'id'), ('quasi', 'quasi'), ('mustStayReadable', 'keep')):
            for t in items(field):
                occ = list(occurrences(text, t))
                if not occ:
                    continue
                ps[tag] += 1
                if tag == 'keep':       # a readable term is damaged if any occurrence is touched
                    hit = any(any(covered[a:b]) for a, b in occ)
                else:                    # an identifier is caught by the model alone only if every occurrence is fully covered
                    hit = all(all(covered[a:b]) for a, b in occ)
                ps[tag + '_hit'] += hit
    print(f'{Path(spansfile).stem} @ {thr}   (model alone, no rules)')
    print(f'  {"set":8} {"ids caught":>14} {"quasi caught":>14} {"readable hit":>14} {"spans":>7}')
    for setname, ps in per_set.items():
        for kk in tot:
            tot[kk] += ps[kk]
        print(f'  {setname:8} {ps["id_hit"]:>6}/{ps["id"]:<7} {ps["quasi_hit"]:>6}/{ps["quasi"]:<7} {ps["keep_hit"]:>6}/{ps["keep"]:<7} {ps["spans"]:>7}')
    print(f'  {"ALL":8} {tot["id_hit"]:>6}/{tot["id"]:<7} {tot["quasi_hit"]:>6}/{tot["quasi"]:<7} {tot["keep_hit"]:>6}/{tot["keep"]:<7} {tot["spans"]:>7}')
    return tot


def inject(spansfile, thr, out, results):
    data = json.load(open(spansfile, encoding='utf-8'))
    papers, _ = load_papers(results)
    m = {}
    for _, text in papers:
        m[text] = [{k: v for k, v in s.items() if not k.startswith('_')} for s in doc_spans(text, data['pieces'], thr)]
    json.dump(m, open(out, 'w', encoding='utf-8'))
    print(f'{out}: {len(m)} documents, {sum(len(v) for v in m.values())} spans')


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'run':
        run(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else DEFAULT_RESULTS)
    elif cmd == 'grade':
        grade(sys.argv[2], float(sys.argv[3]), sys.argv[4] if len(sys.argv) > 4 else DEFAULT_RESULTS)
    elif cmd == 'inject':
        inject(sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else DEFAULT_RESULTS)
