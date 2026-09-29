# Builds models/onnx-community/gliner_multi_pii-v1-latin/ from the original
# gliner_multi_pii-v1 fp16 export (urchade/gliner_multi_pii-v1, Apache-2.0).
#
#   python tools/trim-deep-model.py <original-model-dir> <output-dir>
#
# The original is in git history before v74 (models/onnx-community/
# gliner_multi_pii-v1/), as seven model_fp16.onnx.partNN slices or one
# model_fp16.onnx. Needs only Python 3 (no onnx package).
#
# What changes: the vocabulary. The model is multilingual, and its 250,101-piece
# vocabulary table was 384 of its 580 MB. This keeps every piece made only of
# Latin letters (accents included), digits, punctuation, symbols and emoji,
# plus pieces with a single Greek letter ("5 μg", "α = .05"): 135,933 pieces,
# 404 MB. No weight is retrained or rounded. The kept rows are copied as they
# are, and the one graph constant holding a token number (the <<ENT>> lookup,
# Equal(input_ids, 250103)) is renumbered. Text in those characters tokenizes
# exactly as before, because a Unigram tokenizer only ever picks pieces that
# are substrings of the text. Checked in September 2026: raw logits identical
# bit for bit on all 1,368 Latin-script sentences of the answer-keyed records.
# Other scripts (Cyrillic, Arabic, Chinese, Devanagari...) now read as unknown.
import glob, json, os, shutil, struct, sys

EMB = 'token_rep_layer.bert_layer.model.embeddings.word_embeddings.weight'
ENT_CONST = '/Constant_2_output_0'
PART = 90 * 1024 * 1024          # slices stay under GitHub's 100 MB file cap
KEEP = [(0x20, 0x7E), (0xA0, 0xFF), (0x100, 0x24F), (0x1E00, 0x1EFF),  # ASCII, Latin
        (0x300, 0x36F), (0x2000, 0x2BFF),                                # accents, symbols
        (0x1F000, 0x1FAFF), (0xFE0F, 0xFE0F), (0x200D, 0x200D)]          # emoji
GREEK = (0x370, 0x3FF)


def keep_piece(piece):
    greek = 0
    for c in piece.replace('▁', ''):
        o = ord(c)
        if GREEK[0] <= o <= GREEK[1]:
            greek += 1
        elif not any(a <= o <= b for a, b in KEEP):
            return False
    return greek <= 1


# ---- protobuf wire format: just enough to edit two tensors, byte-exact elsewhere
def read_varint(b, i):
    shift = result = 0
    while True:
        c = b[i]; i += 1
        result |= (c & 0x7F) << shift
        if not c & 0x80:
            return result, i
        shift += 7


def varint(n):
    out = bytearray()
    while True:
        c = n & 0x7F; n >>= 7
        out.append(c | 0x80 if n else c)
        if not n:
            return bytes(out)


def parse(b):
    i, out = 0, []
    while i < len(b):
        key, i = read_varint(b, i)
        f, wt = key >> 3, key & 7
        if wt == 0:
            v, i = read_varint(b, i)
        elif wt == 2:
            n, i = read_varint(b, i); v = b[i:i + n]; i += n
        elif wt == 1:
            v = b[i:i + 8]; i += 8
        elif wt == 5:
            v = b[i:i + 4]; i += 4
        else:
            raise ValueError(f'wire type {wt}')
        out.append((f, wt, v))
    return out


def encode(fields):
    parts = []
    for f, wt, v in fields:
        parts.append(varint(f << 3 | wt))
        if wt == 0:
            parts.append(varint(v))
        elif wt == 2:
            parts += [varint(len(v)), bytes(v)]
        else:
            parts.append(bytes(v))
    return b''.join(parts)


def text(v):
    return bytes(v).decode()


def main(src, out):
    tok = json.load(open(os.path.join(src, 'tokenizer.json'), encoding='utf-8'))
    vocab = tok['model']['vocab']
    n = len(vocab)
    assert sorted(a['id'] for a in tok['added_tokens']) == [0, 1, 2, 3, n, n + 1, n + 2, n + 3]
    kept = [i for i, (p, _) in enumerate(vocab) if i < 4 or keep_piece(p)]   # 0..3 stay put
    k = len(kept)
    idmap = {old: new for new, old in enumerate(kept)}
    idmap.update({n + j: k + j for j in range(4)})   # [MASK] [FLERT] <<ENT>> <<SEP>>

    os.makedirs(os.path.join(out, 'onnx'), exist_ok=True)
    tok['model']['vocab'] = [vocab[i] for i in kept]
    tok['model']['unk_id'] = idmap[tok['model']['unk_id']]
    for a in tok['added_tokens']:
        a['id'] = idmap[a['id']]
    for st in tok['post_processor']['special_tokens'].values():
        st['ids'] = [idmap[x] for x in st['ids']]
    json.dump(tok, open(os.path.join(out, 'tokenizer.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    cfg = json.load(open(os.path.join(src, 'tokenizer_config.json'), encoding='utf-8'))
    cfg['added_tokens_decoder'] = {str(idmap[int(i)]): v for i, v in cfg['added_tokens_decoder'].items()}
    json.dump(cfg, open(os.path.join(out, 'tokenizer_config.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    for f in ('special_tokens_map.json', 'config.json'):
        shutil.copy(os.path.join(src, f), os.path.join(out, f))

    whole = os.path.join(src, 'onnx', 'model_fp16.onnx')
    parts = sorted(glob.glob(whole + '.part*'))
    model = memoryview(open(whole, 'rb').read() if not parts else b''.join(open(p, 'rb').read() for p in parts))
    row = 768 * 2                                       # one fp16 embedding row
    done = {'table': 0, 'ent': 0}
    new_top = []
    for f, wt, v in parse(model):
        if f != 7:                                      # ModelProto.graph
            new_top.append((f, wt, v)); continue
        graph = []
        for gf, gwt, gv in parse(v):
            if gf == 5:                                 # GraphProto.initializer
                fields = parse(gv)
                if any(tf == 8 and text(tv) == EMB for tf, _, tv in fields):
                    raw = next(tv for tf, _, tv in fields if tf == 9)
                    assert len(raw) == (n + 4) * row
                    rows = b''.join(bytes(raw[i * row:(i + 1) * row]) for i in kept + list(range(n, n + 4)))
                    gv = encode([(1, 2, varint(k + 4) + varint(768))]
                                + [(tf, twt, rows if tf == 9 else tv) for tf, twt, tv in fields if tf != 1])
                    done['table'] += 1
            elif gf == 1:                               # GraphProto.node
                fields = parse(gv)
                if [text(x) for g, _, x in fields if g == 2] == [ENT_CONST]:
                    def retag(attr):
                        new = []
                        for af, awt, av in parse(attr):
                            if af == 5:                 # AttributeProto.t
                                t = []
                                for tf, twt, tv in parse(av):
                                    if tf == 9:
                                        assert struct.unpack('<q', bytes(tv))[0] == n + 2
                                        tv = struct.pack('<q', idmap[n + 2])
                                    t.append((tf, twt, tv))
                                av = encode(t)
                            new.append((af, awt, av))
                        return encode(new)
                    gv = encode([(g, w, retag(x) if g == 5 else x) for g, w, x in fields])
                    done['ent'] += 1
            graph.append((gf, gwt, gv))
        assert done == {'table': 1, 'ent': 1}, done
        new_top.append((f, wt, encode(graph)))
    result = encode(new_top)
    for i, off in enumerate(range(0, len(result), PART)):
        open(os.path.join(out, 'onnx', f'model_fp16.onnx.part{i:02d}'), 'wb').write(result[off:off + PART])
    print(f'kept {k} of {n} pieces; {len(model) / 1e6:.1f} MB -> {len(result) / 1e6:.1f} MB '
          f'in {-(-len(result) // PART)} slices')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__ or 'usage: trim-deep-model.py <original-model-dir> <output-dir>')
    main(sys.argv[1], sys.argv[2])
