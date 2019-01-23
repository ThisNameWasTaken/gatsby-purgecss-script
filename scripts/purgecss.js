
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
const jsExtractor = /[A-Za-z0-9-_:\/]+/g

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

class JsExtractor {
  static extract(content) {
    const res = content.match(extractorPattern);
    console.error('extracted selectors:');
    console.error(res);
    return res || [];
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
    path.join(PATHS.node_modules, '/@material/!(react-*)/**/!(*.d).{ts,js,jsx,tsx}'),
  ],
  css: [path.join(PATHS.public, '/**/*.css')],
  // whitelistPatterns: [/-upgraded/, /-ripple/], // Keep selectors that match this patterns
  // TODO: Check purgecss' keyframes purging algorithm, since it does not seem to work for multiple animations
  keyframes: true, // Remove unused keyframes
  fontFace: true, // Remove unsued @font-face rules
  rejected: true,
});

const purgeResult = purgeCss.purge();

// console.log(purgeResult);

(async () => {
  // Write the resulted css in each css file
  await Promise.all(purgeResult.map(key => writeFile(key.file, key.css))); // start removing css selectors only after the css files have been written

  // Remove the unsued css from the inlined styles inside the html files
  glob(`${PATHS.public}/**/*.html`, (err, files) =>
    files.forEach(async file => {
      let html = await readFile(file, 'utf8');
      const inlinedStylePattern = /<style data-href="\/([\s\S]*?)">([\s\S]*?)<\/style>/g;

      let styleTagMatches = inlinedStylePattern.exec(html);
      while (styleTagMatches) {
        const cssFileName = styleTagMatches[1];
        const inlinedStyles = styleTagMatches[2];

        for (let i = 0; i < purgeResult.length; i++) {
          if (path.basename(purgeResult[i].file) === cssFileName) {
            console.log(cssFileName);
            console.log(purgeResult[i].css);

            const purgeCss = new PurgeCss({
              extractors: [{
                extractor: JsExtractor,
                extensions: ['css'],
              }],
              content: [{
                raw: purgeResult[i].css,
                extension: 'css'
              }],
              css: [{ raw: inlinedStyles }],
              rejected: true,
            });

            const pRes = purgeCss.purge();

            console.log(pRes);
          }
          if (path.basename(purgeResult[i].file) === cssFileName) {
            // const purgeCss = new PurgeCss({
            //   extractors: [{
            //     extractor: JsExtractor,
            //     extensions: ['css'],
            //   }],
            //   content: [{
            //     raw: purgeResult[i].css,
            //     extension: 'css'
            //   }],
            //   css: [{ raw: inlinedStyles }],
            //   rejected: true,
            // });

            // const pRes = purgeCss.purge();

            // console.log(pRes);

            // const purgedInlinedStyles = pRes[0].css;

            // html = html.replace(inlinedStyles, purgedInlinedStyles);

            // break;
          }
        }

        styleTagMatches = inlinedStylePattern.exec(html);
      }

      return;

      // Purge the css inside each inlined style tag
      purgeResult.forEach(key => {
        // console.log(key);
        const cssFileName = path.basename(key.file);
        const styleTagMatches = html.match(new RegExp(`<style data-href="/${RegExp.escape(cssFileName)}">([\\s\\S]*?)</style>`));

        if (!styleTagMatches) { return; }

        const inlinedStyles = styleTagMatches[1];

        if (!inlinedStyles) { return; }

        // Since the css files have already been purged, we can use them to only keep the needed selectors
        const purgeCss = new PurgeCss({
          extractors: [{
            extractor: JsExtractor,
            extensions: ['css'],
          }],
          content: [{
            raw: key.css,
            extension: 'css'
          }],
          css: [{ raw: inlinedStyles }],
          rejected: true
        });

        const pRes = purgeCss.purge();

        // if (cssFileName.startsWith('11')) {
        // console.log(pRes);
        // }

        const purgedInlinedStyles = pRes[0].css;
        // if (!pRes[0].css.startsWith('html')) {
        //   console.log(pRes[0].css, pRes[0].rejected);
        // }

        html = html.replace(inlinedStyles, purgedInlinedStyles);
      });

      // Update the file
      writeFile(file, html, 'utf8');
    })
  );
})()
