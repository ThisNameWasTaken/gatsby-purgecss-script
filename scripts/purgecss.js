
const path = require('path');
const glob = require('glob');
const PurgeCss = require('purgecss');
const { promisify } = require('util');
const { readFile: _readFile, writeFile: _writeFile } = require('fs');

const writeFile = promisify(_writeFile);
const readFile = promisify(_readFile);

const PATHS = {
  public: path.join(__dirname, '../public'),
  node_modules: path.join(__dirname, '../node_modules')
}

/**
 * @param {String} string
 */
RegExp.escape = function (string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const extractorPattern = /[A-Za-z0-9-_\/]+/g;

class HtmlBodyExtractor {
  static extract(content) {
    const body = content.match(/<body>[\s\S]+<\/body>/)[0];

    if (!body) { return []; }

    return body.match(extractorPattern) || [];
  }
}

class DefaultExtractor {
  static extract(content) {
    return content.match(extractorPattern) || [];
  }
}

const purgeCss = new PurgeCss({
  extractors: [{
    extractor: HtmlBodyExtractor, // Only purge the body so we do not take into account the selectors from the inlined styles (which are not yet purged)
    extensions: ['html'],
  }, {
    extractor: DefaultExtractor,
    extensions: ['js', 'jsx', 'ts', 'tsx']
  }],
  content: [
    path.join(PATHS.public, '/**/*.html'),
    path.join(PATHS.node_modules, '/@material/!(react-*)/**/!(*.d).{js,jsx,tsx,tsx}'),
  ],
  css: [path.join(PATHS.public, '/**/*.css')],
  // whitelistPatterns: [/-upgraded/, /-ripple/], // Keep selectors that match this patterns
  // TODO: Check purgecss' keyframes purging algorithm, since it does not seem to work for multiple animations
  keyframes: true, // Remove unused keyframes
  fontFace: true, // Remove unsued @font-face rules
  // rejected: true,
});

const purgeResults = purgeCss.purge();

(async () => {
  // Write the resulted css in each css file
  await Promise.all(purgeResults.map(key => writeFile(key.file, key.css))); // start removing css selectors only after the css files have been written

  // Remove the unsued css from the inlined styles inside the html files
  glob(`${PATHS.public}/**/*.html`, (err, files) =>
    files.forEach(async file => {
      let html = await readFile(file, 'utf8');
      const inlinedStylePattern = /<style data-href="\/.*?">.*?<\/style>/gm;

      const styleTags = html.match(inlinedStylePattern);
      styleTags.forEach(styleTag => {
        const [, cssFile, inlinedStyles] = styleTag.match(/<style data-href="\/(.*?)">(.*?)<\/style>/m);

        const purgedCss = purgeResults.find(result => path.basename(result.file) === cssFile).css;

        // since the css files have already been purged
        // we use the selector inside them to remove
        // the unsued selectors from the inlined styles
        const purgeCss = new PurgeCss({
          extractors: [{
            extractor: DefaultExtractor,
            extensions: ['css'],
          }],
          content: [{
            raw: purgedCss,
            extension: 'css'
          }],
          css: [{ raw: inlinedStyles }],
          rejected: true,
        });

        const purgedInlinedStyles = purgeCss.purge()[0].css;
        html = html.replace(inlinedStyles, purgedInlinedStyles);
      });

      writeFile(file, html, 'utf8');
    })
  );
})();
