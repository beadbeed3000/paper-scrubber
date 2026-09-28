// Ad-hoc signs the Mac app in one pass (mac.sign in package.json; build time
// only, not shipped). electron-builder 26's own signer runs codesign once per
// file in the bundle, and on the GitHub Mac runner it sat for over half an hour
// without finishing. One `codesign --deep` over the bundle is the standard
// ad-hoc sign for an Electron app and takes seconds. No certificate and no
// timestamp: an ad-hoc signature has no identity to vouch for. The workflow
// checks the result with `codesign --verify --deep --strict`.
const { execFileSync } = require('node:child_process');

exports.default = async function adhocSign(opts) {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', opts.app], { stdio: 'inherit' });
};
