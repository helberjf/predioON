"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
function _bodyParser() {
  const data = require("body-parser");
  _bodyParser = function () {
    return data;
  };
  return data;
}
function _connect() {
  const data = _interopRequireDefault(require("connect"));
  _connect = function () {
    return data;
  };
  return data;
}
function _open() {
  const data = _interopRequireDefault(require("open"));
  _open = function () {
    return data;
  };
  return data;
}
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// open@6 launches URLs through `cmd /c start` on Windows and only escapes `&`.
// Reject the remaining cmd metacharacters, including `%` and `!` expansion,
// even though this also rejects some otherwise-valid percent-encoded URLs.
const WINDOWS_SHELL_SPECIAL_CHARS = /[|<>^%!]/;
const INVALID_URL = 'Invalid URL';
function sendResponse(res, statusCode, message) {
  res.writeHead(statusCode);
  res.end(message);
}
function isSafeHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') || hostname === encodeURIComponent(hostname);
}
function validateURLForOpen(url) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Invalid URL protocol');
  }
  if (!isSafeHostname(parsedUrl.hostname)) {
    throw new Error('Invalid URL hostname');
  }
  if (WINDOWS_SHELL_SPECIAL_CHARS.test(parsedUrl.href)) {
    throw new Error('Invalid URL characters');
  }
  return parsedUrl.href;
}

/**
 * Open a URL in the system browser.
 */
async function openURLMiddleware(req, res, next) {
  if (req.method === 'POST') {
    if (req.body == null) {
      sendResponse(res, 400, 'Missing request body');
      return;
    }
    const {
      url
    } = req.body;
    if (typeof url !== 'string') {
      sendResponse(res, 400, 'URL must be a string');
      return;
    }
    let validatedUrl;
    try {
      validatedUrl = validateURLForOpen(url);
    } catch {
      sendResponse(res, 400, INVALID_URL);
      return;
    }
    await (0, _open().default)(validatedUrl);
    sendResponse(res, 200);
    return;
  }
  next();
}
var _default = (0, _connect().default)().use((0, _bodyParser().json)()).use(openURLMiddleware);
exports.default = _default;

//# sourceMappingURL=openURLMiddleware.js.map