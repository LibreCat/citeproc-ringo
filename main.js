#!/usr/bin/env ringo

var response = require("ringo/jsgi/response");
var fs = require('fs');
var {parseParameters} = require("ringo/utils/http");
var csl = require('./csl');
var config = require('./config');

var styles      = {},
    locales     = {},
    stylesPath  = config.stylesPath,
    localesPath = config.localesPath,
    engines     = new java.lang.ThreadLocal;

if (fs.isRelative(stylesPath)) stylesPath = module.resolve(config.stylesPath);
if (fs.isRelative(localesPath)) localesPath = module.resolve(config.localesPath);
if (!fs.isDirectory(stylesPath)) throw "csl styles path doesn't exist: "+stylesPath;
if (!fs.isDirectory(localesPath)) throw "csl locales path doesn't exist: "+localesPath;

fs.list(stylesPath).forEach(function(file) {
    if (fs.extension(file) === '.csl') {
        var style = fs.base(file, '.csl');
        var path = fs.join(stylesPath, file);
        styles[style] = fs.read(path);
    }
});

fs.list(localesPath).forEach(function(file) {
    var match = /^locales-([^.]+)\.xml$/.exec(file);
    if (match) {
        var locale = match[1];
        var path = fs.join(localesPath, file);
        locales[locale] = fs.read(path);
    }
});

var isValidStyle = function (style) {
    return styles.hasOwnProperty(style);
};

var isValidLocale = function (locale) {
    return locales.hasOwnProperty(locale);
};

var isValidFormat = function (format) {
    return format === 'text' || format === 'rtf' || format === 'html';
};

var getStyle = function (style) {
    return styles[style];
}

var getLocale = function (locale) {
    return locales[locale];
}

var Sys = function () {
    this.abbreviations = {default: {}};
};

Sys.prototype.retrieveLocale = getLocale;

Sys.prototype.retrieveItem = function (key) {
	  return this.items[key];
};

Sys.prototype.getAbbreviations = function (context) {
	  return this.abbreviations[context] || {};
};

var getEngine = function (style, locale) {
    var cache = engines.get();
    if (!cache) {
        cache = {};
        engines.set(cache);
    }
    var cacheKey = style+'/'+locale;
    if (cache.hasOwnProperty(cacheKey)) {
        return cache[cacheKey];
    }
    var engine = new csl.Engine(new Sys(), getStyle(style), locale);
    cache[cacheKey] = engine;
    return engine;
};

var jsonError = function (status, headers, error) {
    headers['Content-Type'] = 'application/json';
    return {
        status: status,
        headers: headers,
        body: [JSON.stringify({error: error})]
    };
};

exports.app = function(req) {
      if (req.method !== 'POST') {
          return jsonError(405, {'Allow': 'POST'}, "method not allowed");
      }
      var body;
      try {
          body = JSON.parse(req.input.read().decodeToString('utf-8'));
      } catch (e) {console.log(e);
          return jsonError(400, {}, "invalid request body");
      }
      if (typeof body.items !== 'object') {
          return jsonError(400, {}, "invalid request body");
      }
      var items = {},
          itemKeys = [];
      for (var i = 0; i < body.items.length; i++) {
        var item = body.items[i];
        var id = item.id;
        itemKeys.push(id);
        items[id] = item;
      }
      var params = {
          style:  config.defaultStyle,
          locale: config.defaultLocale,
          format: config.defaultFormat
      };
      parseParameters(req.queryString, params);
      if (!isValidStyle(params.style)) {
          return jsonError(400, {}, "unknown style: "+params.style);
      }
      if (!isValidLocale(params.locale)) {
          return jsonError(400, {}, "unknown locale: "+params.locale);
      }
      if (!isValidFormat(params.format)) {
          return jsonError(400, {}, "unknown format: "+params.format);
      }

      var engine = getEngine(params.style, params.locale);
      engine.sys.items = items;
      engine.updateItems(itemKeys, true);
      engine.setOutputFormat(params.format);

      var bib = engine.makeBibliography();
      var res = {
          items: bib[1],
          before: bib[0].bibstart || "",
          after: bib[0].bibend || ""
      };

      if (params.callback) {
          return {
              status: 200,
              headers: {'Content-Type': 'text/javascript'},
              body: [params.callback, '(', JSON.stringify(res), ');']
          };
      }
      return response.json(res);
};

if (require.main == module) {
    require("ringo/httpserver").main(module.id);
}

