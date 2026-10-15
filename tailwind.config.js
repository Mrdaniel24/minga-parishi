/* Build config for assets/css/tailwind.css (run `npm run build:css` after
   changing classes in any page). The theme itself lives in
   assets/js/admin-tw-config.js — the same file the browser used with the
   Tailwind CDN — so colours and fonts stay defined in one place. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { tailwind: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'assets/js/admin-tw-config.js'), 'utf8'), sandbox);
const shared = sandbox.tailwind.config;

module.exports = {
  ...shared,
  content: [
    './public/**/*.html',
    './admin/**/*.html',
    './super-admin/**/*.html',
    './member/**/*.html',
    './parish/**/*.html',
    './assets/js/**/*.js',
  ],
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
};
