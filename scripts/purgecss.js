
const path = require('path');
const glob = require('glob');
const PurgeCss = require('purgecss');
const { writeFileSync, readFileSync } = require('fs');

const PATHS = {
  public: path.join(__dirname, '../public')
}

/**
 * @param {String} string
 */
RegExp.escape = function (string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const extractorPattern = /[A-Za-z0-9-_:\/]+/g;

class PurgeHtmlBody {
  static extract(content) {
    const body = content.match(/<body>[\s\S]+<\/body>/)[0];

    if (!body) { return []; }

    return body.match(extractorPattern) || [];
  }
}

class PurgeInlinedStyles {
  static extract(content) {
    return content.match(extractorPattern) || [];
  }
}

const purgeCss = new PurgeCss({
  extractors: [{
    extractor: PurgeHtmlBody, // Only purge the body so we do not take into account the selectors from the inlined styles (which are not yet purged)
    extensions: ['html'],
  }],
  content: [path.join(PATHS.public, '/**/*.html')],
  css: [path.join(PATHS.public, '/**/*.css')],
  whitelistPatterns: [/-upgraded/, /-ripple/], // Keep selectors that match this patterns
  // TODO: Check purgecss' keyframes purging algorithm, since it does not seem to work for multiple animations
  // keyframes: true, // Remove unused keyframes
  fontFace: true // Remove unsued @font-face rules 
});

const purgeResult = purgeCss.purge();

// Write the resulted css in each css file
purgeResult.forEach(key => writeFileSync(key.file, key.css)); // TODO: Write each file async

// Remove the unsued css from the inlined styles inside the html files
glob(`${PATHS.public}/**/*.html`, (err, files) =>
  files.forEach(file => {
    let html = readFileSync(file, 'utf8');  // TODO: Read each file async

    // Purge the css inside each inlined style tag
    purgeResult.forEach(key => {
      const cssFileName = path.basename(key.file);
      const styleTagMatches = html.match(new RegExp(`<style data-href="/${RegExp.escape(cssFileName)}">([\\s\\S]*?)</style>`));

      if (!styleTagMatches) { return; }

      const inlinedStyles = styleTagMatches[1];

      if (!inlinedStyles) { return; }

      // Since the css files have already been purged, we can use them to only keep the needed selectors
      const purgeCss = new PurgeCss({
        extractors: [{
          extractor: PurgeInlinedStyles,
          extensions: ['css'],
        }],
        content: [{
          raw: key.css,
          extension: 'css'
        }],
        css: [{ raw: inlinedStyles }],
      });

      const purgedInlinedStyles = purgeCss.purge()[0].css;

      html = html.replace(inlinedStyles, purgedInlinedStyles);
    });

    // Update the file
    writeFileSync(file, html, 'utf8'); // TODO: Write this file async
  })
);

// TODO: Use async functions for reading and writing files