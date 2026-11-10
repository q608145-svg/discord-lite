"use strict";

const { EventEmitter } = require("node:events");

/** Общая шина: REST → WebSocket-события (new-message и т.п.). */
const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = { bus };
