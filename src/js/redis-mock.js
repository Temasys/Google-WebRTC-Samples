/* jshint unused:true, undef:true, strict:true, plusplus:true */
/* global setTimeout:false, module:false, exports:true, clearTimeout:false, require:false, process:false */

(function () {

    // Baseline setup
    // --------------

    "use strict";

    // Establish the root object, `window` in the browser, or `exports` on the server.
    var root = this;

    // Create the mock object.
    var redismock = {};

    function exists(v) {
        return typeof v !== 'undefined' && v !== null;
    }

    // Export the mock object for **node.js/io.js**, with
    // backwards-compatibility for the old `require()` API. If we're in
    // the browser, add `redismock` as a global object.
    if (typeof exports !== 'undefined') {
        if (typeof module !== 'undefined' && module.exports) {
            exports = module.exports = redismock;
        }
        exports.redismock = redismock;
    } 
    else {
        root.redismock = redismock;
    }

    // We use setImmediate for callback-style returns,
    // but it is non-standard. To standardize, convert
    // setImmediate to its equivalent (mostly) counterpart --
    // setTimeout(f, 0) -- if it is not available.
    if (typeof setImmediate === 'undefined' || typeof setImmediate !== 'function') {
        var setImmediate = function (f) {
            setTimeout(f, 0);
        };
    }

    redismock.Array = Array;

    function SortedSet() {
        this.scores = [];
        this.set = {};
        this.invset = {};
        this.indices = {};
        this.lengths = {};
        this.card = 0;
        return this;
    }
    SortedSet.prototype.add = function (score, member) {
        var ret = 1;
        if (exists(this.invset[member])) {
            this.rem(member);
            ret = 0;
        }
        if (!exists(this.set[score])) {
            this.scores.push(score);
            this.set[score] = [];
            this.lengths[score] = 0;
        }
        this.set[score].push(member);
        this.invset[member] = score;
        this.indices[member] = this.set[score].length - 1;
        this.lengths[score] += 1;
        this.card += 1;
        return ret;
    };
    SortedSet.prototype.rem = function (member) {
        var score;
        if (!exists(this.invset[member])) {
            return 0;
        }
        score = this.invset[member];
        this.set[score].splice(this.set[score].indexOf(member), 1);
        this.lengths[score] -= 1;
        if (this.lengths[score] === 0) {
            this.set[score] = undefined;
            this.scores.splice(this.scores.indexOf(score), 1);
        }
        this.invset[member] = undefined;
        this.indices[member] = undefined;
        this.card -= 1;
        return 1;
    };
    SortedSet.prototype.sortScores = function () {
        this.scores.sort(function (a, b) {
            return parseInt(a, 10) - parseInt(b, 10);
        });
        return this;
    };
    SortedSet.prototype.sortScoresRev = function () {
        this.scores.sort(function (a, b) {
            return parseInt(b, 10) - parseInt(a, 10);
        });
        return this;
    };
    redismock.SortedSet = function () {
        return new SortedSet();
    };

    // The database.
    var cache = {};
    var timeouts = {};
    var subscribers = [];
    var watchers = {};
    var sets = 'sets-' + Math.random();
    var zsets = 'zsets-' + Math.random();
    var hashes = 'hashes-' + Math.random();
    //var keys = [];
    cache[sets] = {};
    cache[zsets] = {};
    cache[hashes] = {};

    // Utils
    // -----

    // From https://gist.github.com/Breton/2699916
    String.prototype.escape = function () {
        var escapable = /[.\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
        var meta;
        /* jshint ignore:start */
        meta = { // table of character substitutions
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '\.': '\\.',
            '"': '\\"',
            '\\': '\\\\'
        };
        /* jshint ignore:end */
        function escapechar(a) {
            var c = meta[a];
            return typeof c === 'string' ? c : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
        }
        return this.replace(escapable, escapechar);
    };
    //Translate a shell PATTERN to a regular expression.
    function translate(pat) {
        //There is no way to quote meta-characters.
        var i=0, j, n = pat.length || 0, res, c, stuff;
        res = '^';
        while (i < n) {
            c = pat[i];
            i = i + 1;
            if (c === '*') {
                res = res + '.*';
            } else if (c === '?') {
                res = res + '.';
            } else if (c === '[') {
                j = i;
                if (j < n && pat[j] === '!') {
                    j = j + 1;
                }
                if (j < n && pat[j] === ']') {
                    j = j + 1;
                }
                while (j < n && pat[j] !== ']') {
                    j = j + 1;
                }
                if (j >= n) {
                    res = res + '\\[';
                } else {
                    stuff = pat.slice(i, j).replace('\\', '\\\\');
                    i = j + 1;
                    if (stuff[0] === '!') {
                        stuff = '^' + stuff.slice(1);
                    } else if (stuff[0] === '^') {
                        stuff = '\\' + stuff;
                    }
                    res = res + '[' + stuff + ']';
                }
            } else {
                res = res + (c).escape();
            }
        }
        return res + '$';
    }

    var cb = function (callback, context) {
        return function () {
            var args = arguments;
            if (callback && typeof callback === "function") {
                setImmediate(function () {
                    callback.apply(context, args);
                });
            }
            if (args[0] instanceof Error) {
                return args[0];
            }
            return args[1];
        };
    };

    var gather = function () {
        return function () {
            var idx, len = arguments.length;
            var callback;
            var list = [];
            for (idx = len - 1; idx >= 0; idx -= 1) {
                if (!callback && typeof arguments[idx] === "function") {
                    callback = arguments[idx];
                }
                else if (exists(arguments[idx])) {
                    list.unshift(arguments[idx]);
                }
            }
            return {
                callback: callback,
                list: list
            };
        };
    };

    var wrongType = function (callback) {
        return cb(callback)(new Error('WRONGTYPE Operation against a key holding the wrong kind of value'));
    };

    redismock.ifType = function (key, type, callback) {
        var that = this;
        return {
            thenex: function (f) {
                this._ifex = f;
                return this;
            },
            thennx: function (f) {
                this._ifnx = f;
                return this;
            },
            then: function (f) {
                this._then = f;
                return this;
            },
            end: function () {
                var ret;
                if (that.exists(key)) {
                    if (that.type(key) !== type) {
                        return wrongType(callback);
                    }
                    if (typeof this._ifex === 'function') {
                        ret = this._ifex.call(that);
                        if (ret && ret instanceof Error) {
                            return cb(callback)(ret);
                        }
                    }
                }
                else {
                    if (typeof this._ifnx === 'function') {
                        ret = this._ifnx.call(that);
                        if (ret && ret instanceof Error) {
                            return cb(callback)(ret);
                        }
                    }
                }
                if (typeof this._then === 'function') {
                    ret = this._then.call(that);
                    if (ret && ret instanceof Error) {
                        return cb(callback)(ret);
                    }
                }
                return cb(callback)(null, ret);
            }
        };
    };

    // Keys Commands
    // -------------

    // Delete a key
    redismock.del = function (key, callback) {
        var that = this;
        var count = 0;
        var g = gather(this.del).apply(this, arguments);
        callback = g.callback;
        var deleter = function (k) {
            if (that.exists(k)) {
                if (k in cache) {
                    cache[k] = undefined;
                }
                else if (k in cache[sets]) {
                    cache[sets][k] = undefined;
                }
                else if (k in cache[zsets]) {
                    cache[zsets][k] = undefined;
                }
                else if (k in cache[hashes]) {
                    cache[hashes][k] = undefined;
                }
                return 1;
            }
            return 0;
        };
        var toDelete = g.list;
        if (typeof g.list[0] === 'object') { // Allow an array to be passed in.
            toDelete = g.list[0];
        }
        toDelete.forEach(function (k) {
            count += deleter(k);
        });
        return cb(callback)(null, count);
    };

    // Return a serialized version of the value stored at the specified key.
    redismock.dump = function (key, callback) {
        return cb(callback)(new Error("UNIMPLEMENTED"));
    };

    // Determine if a key exists.
    redismock.exists = function (key, callback) {
        return cb(callback)(null, (exists(cache[key]) || exists(cache[sets][key]) || exists(cache[zsets][key]) || exists(cache[hashes][key])) ? 1 : 0);
    };

    // Set a key's time to live in seconds.
    redismock.expire = function (key, seconds, callback) {
        return this.pexpire(key, seconds*1000, callback);
    };

    // Set the expiration for a key as a UNIX timestamp.
    redismock.expireat = function (key, timestamp, callback) {
        var now = new Date();
        return this.pexpire(key, timestamp*1000 - now.getTime(), callback);
    };

    // Find all the keys matching a given pattern.
    redismock.keys = function (pattern, callback) {
        var keys = [], key;
        var regex = new RegExp(translate(pattern));
        for (key in cache) {
            if (key === sets || key === zsets || key === hashes) {
                continue;
            }
            if (cache.hasOwnProperty(key)) {
                if (key.match(regex) !== null) {
                    keys.push(key);
                }
            }
        }
        for (key in cache[sets]) {
            if (cache[sets].hasOwnProperty(key)) {
                if (key.match(regex) !== null) {
                    keys.push(key);
                }
            }
        }
        for (key in cache[zsets]) {
            if (cache[zsets].hasOwnProperty(key)) {
                if (key.match(regex) !== null) {
                    keys.push(key);
                }
            }
        }
        for (key in cache[hashes]) {
            if (cache[hashes].hasOwnProperty(key)) {
                if (key.match(regex) !== null) {
                    keys.push(key);
                }
            }
        }
        return cb(callback)(null, keys);
    };

    // Atomically transfer a key from a Redis instance to another one.
    redismock.migrate = function (host, port, key, destination_db, timeout, callback) {
        return cb(callback)(new Error("UNIMPLEMENTED"));
    };

    // Move a key to another database.
    redismock.move = function (key, db, callback) {
        return cb(callback)(new Error("UNIMPLEMENTED"));
    };

    // Inspect the internals of Redis objects.
    redismock.object = function (subcommand, callback) {
        return cb(callback)(new Error("UNIMPLEMENTED"));
    };

    // Remove the expiration from a key.
    redismock.persist = function (key, callback) {
        if (this.exists(key) && timeouts[key]) {
            clearTimeout(timeouts[key].timeout);
            return cb(callback)(null, 1);
        }
        return cb(callback)(null, 0);
    };

    // Set a key's time to live in milliseconds.
    redismock.pexpire = function (key, milliseconds, callback) {
        var that = this;
        if (this.exists(key)) {
            if (timeouts[key]) {
                clearTimeout(timeouts[key].timeout);
            }
            if (milliseconds <= 0) {
                this.del(key);
            }
            else {
                timeouts[key] = {};
                timeouts[key].start = new Date();
                timeouts[key].end = (new Date(timeouts[key].start.getTime() + milliseconds));
                timeouts[key].timeout = setTimeout(function () {
                    timeouts[key] = undefined;
                    that.del(key);
                }, milliseconds);
            }
            return cb(callback)(null, 1);
        }
        return cb(callback)(null, 0);
    };

    // Set the expiration for a key as a UNIX timestamp specified in milliseconds.
    redismock.pexpireat = function (key, timestamp, callback) {
        var now = new Date();
        return this.pexpire(key, timestamp - now.getTime(), callback);
    };

    // Get the time to live for a key in milliseconds.
    redismock.pttl = function (key, callback) {
        var now = new Date();
        if (timeouts[key]) {
            return cb(callback)(null, timeouts[key].end.getTime() - now.getTime());
        }
        return cb(callback)(null, this.exists(key) ? -1 : -2);
    };

    // Return a random key from the keyspace.
    redismock.randomkey = function (callback) {
        var rando = null;
        function loop_through(count, looper) {
            var key;
            for (key in looper) {
                if (key === sets) {
                    count = loop_through(count, cache[sets]);
                    continue;
                }
                else if (key === zsets) {
                    count = loop_through(count, cache[zsets]);
                    continue;
                }
                else if (key === hashes) {
                    count = loop_through(count, cache[hashes]);
                    continue;
                }
                else if (Math.random() < 1/count) {
                    rando = key;
                }
                count += 1;
            }
            return count;
        }
        loop_through(1, cache);
        return cb(callback)(null, rando);
    };

    // Rename a key.
    redismock.rename = function (key, newkey, callback) {
        var type;
        if (!this.exists(key)) {
            return cb(callback)(new Error('ERR no such key'));
        }
        if (key === newkey) {
            return cb(callback)(null, 'OK');
        }
        type = this.type(key);
        if (type === 'string' || type === 'list') {
            cache[newkey] = cache[key];
        }
        else if (type === 'set') {
            cache[sets][newkey] = cache[sets][key];
        }
        else if (type === 'zset') {
            cache[zsets][newkey] = cache[zsets][key];
        }
        else if (type === 'hash') {
            cache[hashes][newkey] = cache[hashes][key];
        }
        // else can't occur yet...
        this.del(key);
        return cb(callback)(null, 'OK');
    };
    
    // Rename a key, only if the new key does not exist.
    redismock.renamenx = function (key, newkey, callback) {
        var r;
        if (this.exists(newkey)) {
            return cb(callback)(null, 0);
        }
        r = this.rename(key, newkey);
        if (r instanceof Error) {
            return cb(callback)(r);
        }
        return cb(callback)(null, 1);
    };

    // Create a key using the provided serialized value, previously obtained using DUMP.
    redismock.restore = function (key, ttl, serialized_value, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    // Sort the elements in a list, set, or sorted set.
    redismock.sort = function (key, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    // Get the time to live for a key.
    redismock.ttl = function (key, callback) {
        var now = new Date();
        if (timeouts[key]) {
            return cb(callback)(null, (timeouts[key].end.getTime() - now.getTime())/1000);
        }
        return cb(callback)(null, this.exists(key) ? -1 : -2);
    };

    // Determine the type stored at key.
    redismock.type = function (key, callback) {
        if (this.exists(key)) {
            var type = typeof cache[key];
            if (type === 'object') {
                if (cache[key] instanceof Array) {
                    type = 'list';
                }
            }
            else if (type === 'undefined') {
                if (key in cache[sets] && cache[sets][key]) {
                    type = 'set';
                }
                else if (key in cache[zsets] && cache[zsets][key]) {
                    type = 'zset';
                }
                else if (key in cache[hashes] && cache[hashes][key]) {
                    type = 'hash';
                }
            }
            return cb(callback)(null, type);
        }
        return cb(callback)(null, 'none');
    };

    // Incrementally iterate the keyspace.
    redismock.scan = function (cursor, callback) {
        var g = gather(this.scan).apply(null, arguments);
        var idx = 0;
        var key;
        var reply = [];
        var count, match;
        g
            .list
            .forEach(function (option, index) {
                if (option === 'count') {
                    count = g.list[index + 1];
                }
                if (option === 'match') {
                    match = new RegExp(translate(g.list[index + 1]));
                }
            });
        if (typeof count === 'undefined' || isNaN(parseInt(count, 10))) {
            count = 10;
        }
        callback = g.callback;
        for (key in cache) {
            if (cache.hasOwnProperty(key)) {
                if (key === sets || key === zsets || key === hashes) {
                    continue;
                }
                idx += 1;
                if (idx > cursor) {
                    if (!exists(match) || key.match(match)) {
                        reply.push(key);
                        if (reply.length >= count) {
                            return cb(callback)(null, [idx, reply]);
                        }
                    }
                }
            }
        }
        for (key in cache[sets]) {
            if (cache[sets].hasOwnProperty(key)) {
                idx += 1;
                if (idx > cursor) {
                    if (!exists(match) || key.match(match)) {
                        reply.push(key);
                        if (reply.length >= count) {
                            return cb(callback)(null, [idx, reply]);
                        }
                    }
                }
            }
        }
        for (key in cache[zsets]) {
            if (cache[zsets].hasOwnProperty(key)) {
                idx += 1;
                if (idx > cursor) {
                    if (!exists(match) || key.match(match)) {
                        reply.push(key);
                        if (reply.length >= count) {
                            return cb(callback)(null, [idx, reply]);
                        }
                    }
                }
            }
        }
        for (key in cache[hashes]) {
            if (cache[hashes].hasOwnProperty(key)) {
                idx += 1;
                if (idx > cursor) {
                    if (!exists(match) || key.match(match)) {
                        reply.push(key);
                        if (reply.length >= count) {
                            return cb(callback)(null, [idx, reply]);
                        }
                    }
                }
            }
        }
        if (!reply.length) {
            idx = 0;
        }
        return cb(callback)(null, [idx, reply]);
    };

    // String Commands
    // ---------------

    // Append a value to a key.
    redismock.append = function (key, value, callback) {
        return this
            .ifType(key, 'string', callback)
            .thenex(function () {
                cache[key] += value;
                return null;
            })
            .thennx(function () {
                return this.set(key, value);
            })
            .then(function () { return cache[key].length; })
            .end();
    };

    /*var hamming_weight_map = {
        0: 0,
        1: 1,
        2: 1,
        3: 2,
        4: 1,
        5: 2,
        6: 2,
        7: 3,
        8: 1,
        9: 2,
        10: 2,
        11: 3,
        12: 2,
        13: 3,
        14: 3,
        15: 4
    };*/

    // Count set bits in a string.
    redismock.bitcount = function (key, callback) {
        var g = gather(this.bitcount).apply(this, arguments);
        var start, end;
        callback = g.callback;
        if (g.list.length === 3) {
            start = g.list[1];
            end = g.list[2];
        }
        return this
            .ifType(key, 'string', callback)
            .thenex(function () {
                var idx, n, count;
                if (!exists(start)) {
                    start = 0;
                }
                if (!exists(end)) {
                    end = cache[key].length - 1;
                }
                if (end >= cache[key].length) {
                    end = cache[key].length - 1;
                }
                if (start < 0) {
                    start = cache[key].length + start;
                }
                if (end < 0) {
                    end = cache[key].length + end;
                }
                if (start > end) {
                    return 0;
                }
                count = 0;
                // TODO: Slow bit-counting, do map to do fast bit counting.
                for (idx = start; idx <= end; idx += 1) {
                    n = cache[key].charCodeAt(idx);
                    while (n) {
                        count += (n & 1);
                        n >>= 1;
                    }
                }
                return count;
            })
            .thennx(function () { return 0; })
            .end();
    };

    // Perform bitwise operations between strings.
    redismock.bitop = function (operation, destkey, key, callback) {
        var that = this;
        var g = gather(this.bitop).apply(this, arguments);
        var longest, strings, string, r;
        operation = typeof operation === 'string' ? operation.toLowerCase() : '';
        if (operation !== 'and' && operation !== 'or' && operation !== 'xor' && operation !== 'not') {
            return cb(callback)(new Error('ERR syntax error'));
        }
        callback = g.callback;
        strings = g
            .list
            .slice(2)
            .map(function (k) {
                if (that.exists(k) && that.type(k) !== 'string') {
                    return null;
                }
                return that.exists(k) ? cache[k] : '';
            });
        if (strings.some(function (str) {
            return str === null;
        })) {
            return wrongType(callback);
        }
        longest = strings.reduce(function (length, str) {
            return str.length > length ? str.length : length;
        }, 0);
        strings = strings.map(function (str) {
            while(str.length < longest) {
                str += '\0';
            }
            return str;
        });
        string = strings
            .reduce(function (cur, str, index) {
                var idx, n, s;
                s = '';
                for (idx = 0; idx < longest; idx += 1) {
                    if (operation === 'and') {
                        n = cur.charCodeAt(idx) & str.charCodeAt(idx);
                    }
                    else if (operation === 'or') {
                        n = cur.charCodeAt(idx) | str.charCodeAt(idx);
                    }
                    else if (operation === 'xor') {
                        // a XOR a = 0, so we have to avoid XOR'ing the first string with itself.
                        if (index > 0) {
                            n = cur.charCodeAt(idx) ^ str.charCodeAt(idx);
                        }
                        else {
                            n = cur.charCodeAt(idx);
                        }
                    }
                    else if (operation === 'not') {
                        n = ~cur.charCodeAt(idx);
                    }
                    s += String.fromCharCode(n);
                }
                return s;
            }, strings[0]);
        r = this.set(destkey, string);
        if (r instanceof Error) {
            return cb(callback)(r);
        }
        return cb(callback)(null, string.length);
    };

    // Find first bit set or clear in a string.
    redismock.bitpos = function (key, bit, callback) {
        var g = gather(this.bitpos).apply(this, arguments);
        var start, end;
        callback = g.callback;
        if (g.list.length > 2) {
            start = g.list[2];
            end = g.list[3];
        }
        if (typeof start === 'undefined') {
            start = 0;
        }
        if (bit !== 0 && bit !== 1) {
            return cb(callback)(new Error('ERR The bit argument must be 1 or 0.'));
        }
        return this
            .ifType(key, 'string', callback)
            .thennx(function () { 
                if (bit === 0) {
                    return 0;
                }
                return -1;
            })
            .thenex(function () {
                var idx, ch, cnt, noend = false;
                if (start < 0) {
                    start = cache[key].length + start;
                }
                if (typeof end === 'undefined') {
                    noend = true;
                    end = cache[key].length - 1;
                }
                if (end < 0) {
                    end = cache[key].length + end;
                }
                if (start > end) {
                    return -1;
                }
                for (idx = start; idx <= end; idx += 1) {
                    ch = cache[key].charCodeAt(idx);
                    cnt = 0;
                    while (cnt < 8) {
                        if (bit === 0 && (ch & 0x80) !== 0x80) {
                            return idx*8 + cnt;
                        }
                        if (bit === 1 && (ch & 0x80) === 0x80) {
                            return idx*8 + cnt;
                        }
                        ch <<= 1;
                        cnt += 1;
                    }
                }
                if (bit === 1) {
                    return -1;
                }
                if (bit === 0 && noend) {
                    return idx*8;
                }
                return -1;
            })
            .end();
    };

    redismock.decr = function (key, callback) {
        return this.decrby(key, 1, callback);
    };

    redismock.decrby = function (key, decrement, callback) {
        return this
            .ifType(key, 'string', callback)
            .thennx(function () { this.set(key, '0'); })
            .then(function () {
                var asInt = parseInt(this.get(key), 10);
                if (isNaN(asInt)) {
                    return new Error("ERR value is not an integer or out of range");
                }
                this.set(key, asInt - decrement);
                return (asInt - decrement);
            })
            .end();
    };

    redismock.get = function (key, callback) {
        if (this.type(key) === 'string') {
            return cb(callback)(null, cache[key]);
        }
        return cb(callback)(null, null);
    };

    // Returns the bit value at offset in the string value stored at key.
    redismock.getbit = function (key, offset, callback) {
        return this
            .ifType(key, 'string', callback)
            .thenex(function () {
                var n, pos;
                if (offset >= (cache[key].length*8)) {
                    return 0;
                }
                n = cache[key].charCodeAt(Math.floor(offset/8));
                pos = offset % 8;
                return (n >> pos) & 1;
            })
            .thennx(function () { return 0; })
            .end();
    };

    // Get a substring of the string stored at a key.
    redismock.getrange = function (key, start, end, callback) {
        return this
            .ifType(key, 'string', callback)
            .thenex(function () {
                var len = 0;
                if (end < 0) {
                    end = cache[key].length + end;
                }
                if (start < 0) {
                    len = end - (cache[key].length + start) + 1;
                }
                else {
                    len = end - start + 1;
                }
                return cache[key].substr(start, len);
            })
            .thennx(function () { return ""; })
            .end();
    };

    // Set the string value of a key and return its old value.
    redismock.getset = function (key, value, callback) {
        var prev = this.get(key);
        this.set(key, value);
        return cb(callback)(null, prev);
    };

    // Increment the integer value of a key by one.
    redismock.incr = function (key, callback) {
        return this.incrby(key, 1, callback);
    };

    // Increment the integer value of a key by the given amount.
    redismock.incrby = function (key, increment, callback) {
        return this
            .ifType(key, 'string', callback)
            .thennx(function () { this.set(key, '0'); })
            .then(function () {
                var asInt = parseInt(this.get(key), 10);
                if (isNaN(asInt)) {
                    return new Error("ERR value is not an integer or out of range");
                }
                this.set(key, asInt + increment);
                return (asInt + increment);
            })
            .end();
    };

    // Increment the float value of a key by the given amount.
    redismock.incrbyfloat = function (key, increment, callback) {
        return this
            .ifType(key, 'string', callback)
            .thennx(function () { this.set(key, '0'); })
            .then(function () {
                var asInt = parseFloat(this.get(key));
                if (isNaN(asInt)) {
                    return new Error("ERR value is not an integer or out of range");
                }
                this.set(key, asInt + increment);
                return this.get(key);
            })
            .end();
    };

    // Get the values of all the given keys.
    redismock.mget = function (key, callback) {
        var g = gather(this.mget).apply(this, arguments);
        callback = g.callback;
        var data = (typeof g.list[0] === 'object') ? g.list[0] : g.list;
        return cb(callback)(null, data.map(function (k) {
            return cache[k] || null;
        }));
    };

    // Set multiple keys to multiple values.
    redismock.mset = function (key, value, callback) {
        var kvs = [];
        var that = this;
        var g = gather(this.mset).apply(this, arguments);
        callback = g.callback;
        g.list.forEach(function (opt, index) {
            if (index % 2 === 0) {
                kvs.push([opt, g.list[index + 1]]);
            }
        });
        kvs.forEach(function (kv) {
            that.set(kv[0], kv[1]);
        });
        return cb(callback)(null, 'OK');
    };

    // Set multiple keys to multiple values only if none of the keys exist.
    redismock.msetnx = function (key, value, callback) {
        var kvs = [];
        var that = this;
        var g = gather(this.msetnx).apply(this, arguments);
        callback = g.callback;
        g.list.forEach(function (opt, index) {
            if (index % 2 === 0) {
                kvs.push([opt, g.list[index + 1]]);
            }
        });
        if (kvs.some(function (kv) {
            return that.exists(kv[0]);
        })) {
            return cb(callback)(null, 0);
        }
        kvs.forEach(function (kv) {
            that.set(kv[0], kv[1]);
        });
        return cb(callback)(null, 1);
    };

    // Set the value and expiration in milliseconds of a key.
    redismock.psetex = function (key, milliseconds, value, callback) {
        this.set(key, value);
        this.pexpire(key, milliseconds);
        return cb(callback)(null, 'OK');
    };

    // Set the string value of a key.
    redismock.set = function (key, value, callback) {
        var nx = false, xx = false, ex = -1, px = -1;
        var g = gather(this.set).apply(this, arguments);
        callback = g.callback;
        g
            .list
            .forEach(function (opt, index) {
                if (opt === 'nx' || opt === 'NX') {
                    nx = true;
                }
                else if (opt === 'xx' || opt === 'XX') {
                    xx = true;
                }
                else if (opt === 'ex' || opt === 'EX') {
                    ex = g.list[index + 1];
                }
                else if (opt === 'px' || opt === 'PX') {
                    px = g.list[index + 1];
                }
            });
        if (nx) {
            if (this.exists(key)) {
                return cb(callback)(null, null);
            }
        }
        if (xx) {
            if (!this.exists(key)) {
                return cb(callback)(null, null);
            }
        }
        cache[key] = exists(value) ? value.toString() : '';
        if (px !== -1) {
            redismock.pexpire(key, px);
        }
        if (ex !== -1) {
            redismock.expire(key, ex);
        }
        return cb(callback)(null, 'OK');
    };

    // Sets or clears the bit at offset in the string value stored at key.
    redismock.setbit = function (key, offset, value, callback) {
        return this
            .ifType(key, 'string', callback)
            .thennx(function () {
                cache[key] = '';
            })
            .then(function () {
                var byteIdx = Math.floor(offset/8);
                var bitIdx = offset % 8;
                var idx, bit, mask;
                var code;
                if (value !== 0 && value !== 1) {
                    return new Error('ERR bit is not an integer or out of range');
                }
                while (cache[key].length < byteIdx + 1) {
                    cache[key] += '\0';
                }
                code = cache[key].charCodeAt(byteIdx);
                idx = 0;
                mask = 0x80;
                while (idx < bitIdx) {
                    mask >>= 1;
                    idx += 1;
                }
                bit = (code & mask) === 0 ? 0 : 1;
                if (value === 0) {
                    code = code & (~mask);
                }
                else {
                    code = code | mask;
                }
                cache[key] = cache[key].substr(0, byteIdx) + String.fromCharCode(code) + cache[key].substr(byteIdx + 1);
                return bit;
            })
            .end();
    };

    // Set the value and expiration of a key.
    redismock.setex = function (key, seconds, value, callback) {
        this.set(key, value);
        this.expire(key, seconds);
        return cb(callback)(null, 'OK');
    };

    // Set the value of the key only if the key does not exist.
    redismock.setnx = function (key, value, callback) {
        if (!this.exists(key)) {
            this.set(key, value);
            return cb(callback)(null, 1);
        }
        return cb(callback)(null, 0);
    };
    
    // Overwrite part of the string at key starting at the specified offset.
    redismock.setrange = function (key, offset, value, callback) {
        return this
            .ifType(key, 'string', callback)
            .thennx(function () {
                cache[key] = '';
            })
            .then(function () {
                var idx, newValue;
                if (cache[key].length < offset + value.length - 1) {
                    for (idx = cache[key].length; idx < offset + value.length; idx += 1) {
                        cache[key] += '\0';
                    }
                }
                newValue = cache[key].substr(0, offset);
                for (idx = offset; idx < offset + value.length; idx += 1) {
                    newValue += value[idx - offset];
                }
                newValue += cache[key].substr(offset + value.length);
                cache[key] = newValue;
                return cache[key].length;
            })
            .end();
    };

    // Get the length of the value stored in a key.
    redismock.strlen = function (key, callback) {
        if (!this.exists(key)) {
            return cb(callback)(null, 0);
        }
        return this
            .ifType(key, 'string', callback)
            .thenex(function () { return cache[key].length; })
            .thennx(function () { return 0; })
            .end();
    };

    // List Commands
    // -------------

    redismock.blpop = function (key, timeout, callback) {
        var that = this;
        var g = gather(this.blpop).apply(null, arguments);
        var keys = g.list.slice(0, g.list.length - 1);
        timeout = g.list[g.list.length - 1];
        callback = g.callback;
        var f, timedout = false;
        f = function () {
            if (timedout) {
                return cb(callback)(null, null);
            }
            if (keys.some(function (k) {
                var len = that.llen(k);
                if (len instanceof Error) {
                    cb(callback)(len);
                    return true;
                }
                if (len > 0) {
                    that.lpop(k, callback);
                    return true;
                }
                return false;
            })) {
                return;
            }
            setImmediate(f);
        };
        if (timeout > 0) {
            setTimeout(function () {
                timedout = true;
            }, timeout*1000);
        }
        setImmediate(f);
        return this;
    };

    redismock.brpop = function (key, timeout, callback) {
       var that = this;
        var g = gather(this.brpop).apply(null, arguments);
        var keys = g.list.slice(0, g.list.length - 1);
        var f, timedout = false;
        timeout = g.list[g.list.length - 1];
        callback = g.callback;
        f = function () {
            if (timedout) {
                return cb(callback)(null, null);
            }
            if (keys.some(function (k) {
                var len = that.llen(k);
                if (len instanceof Error) {
                    cb(callback)(len);
                    return true;
                }
                if (len > 0) {
                    that.rpop(k, callback);
                    return true;
                }
                return false;
            })) {
                return;
            }
            setImmediate(f);
        };
        if (timeout > 0) {
            setTimeout(function () {
                timedout = true;
            }, timeout*1000);
        }
        setImmediate(f);
        return this;
    };

    redismock.brpoplpush = function (source, destination, timeout, callback) {
        var that = this;
        var f, timedout = false;
        f = function () {
            var len;
            if (timedout) {
                return cb(callback)(null, null);
            }
            len = that.llen(source);
            if (len instanceof Error) {
                return cb(callback)(len);
            }
            if (len > 0) {
                that.rpoplpush(source, destination, callback);
                return;
            }
            setImmediate(f);
        };
        if (timeout > 0) {
            setTimeout(function () {
                timedout = true;
            }, timeout*1000);
        }
        setImmediate(f);
        return this;
    };

    redismock.lindex = function (key, i, callback) {
        var elem = null;
        return this
            .ifType(key, 'list', callback)
            .thenex(function () {
                if (i >= 0 && i < cache[key].length) {
                    elem = cache[key][i];
                }
                else if (i < 0 && cache[key].length + 1 >= 0) {
                    elem = cache[key][cache[key].length + i];
                }
            })
            .then(function () { return elem; })
            .end();
    };

    redismock.linsert = function (key, beforeafter, pivot, value, callback) {
        return this
            .ifType(key, 'list', callback)
            .thenex(function () {
                var idx = cache[key].indexOf(pivot);
                if (idx !== -1) {
                    if (beforeafter === 'before') {
                        cache[key].splice(idx, 0, value);
                    }
                    else if (beforeafter === 'after') {
                        cache[key].splice(idx + 1, 0, value);
                    }
                    return cache[key].length;
                }
                return -1;
            })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.llen = function (key, callback) {
        return this
            .ifType(key, 'list', callback)
            .thenex(function () { return cache[key].length; })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.lpop = function (key, callback) {
        return this
            .ifType(key, 'list', callback)
            .thenex(function () { 
                var popped = cache[key].shift();
                if (!cache[key].length) {
                    this.del(key);
                }
                return popped;
            })
            .thennx(function () { return null; })
            .end();
    };

    redismock.lpush = function (key, element, callback) {
        var g = gather(this.lpush).apply(this, arguments);
        callback = g.callback;
        return this
            .ifType(key, 'list', callback)
            .thennx(function () { cache[key] = new redismock.Array(); })
            .then(function () {
                g.list.slice(1).forEach(function (elem) {
                    cache[key].unshift(elem);
                });
                return cache[key].length;
            })
            .end();
    };

    redismock.lpushx = function (key, element, callback) {
        return this
            .ifType(key, 'list', callback)
            .thenex(function () {
                cache[key].unshift(element);
                return cache[key].length;
            })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.lrange = function (key, start, end, callback) {
        var l = [];
        return this
            .ifType(key, 'list', callback)
            .thenex(function () {
                if (start > cache[key].length - 1) {
                    l = [];
                }
                else {
                    if (start < 0) {
                        start = cache[key].length + start;
                    }
                    if (end < 0) {
                        end = cache[key].length + end;
                    }
                    if (start > end) {
                        l = [];
                    }
                    else {
                        l = cache[key].slice(start, end + 1);
                    }
                }
            })
            .then(function () { return l; })
            .end();
    };

    redismock.lrem = function (key, count, element, callback) {
        var cnt = 0;
        return this
            .ifType(key, 'list', callback)
            .thenex(function () {
                var idx;
                while (true) {
                    idx = cache[key].indexOf(element);
                    if (idx === -1) {
                        break;
                    }
                    cache[key].splice(idx, 1);
                    cnt += 1;
                    if (count > 0 && cnt === count) {
                        break;
                    }
                }
                if (!cache[key].length) {
                    this.del(key);
                }
            })
            .then(function () { return cnt; })
            .end();
    };

    redismock.lset = function (key, index, element, callback) {
        return this
            .ifType(key, 'list', callback)
            .thenex(function () { 
                if (index >= cache[key].length) {
                    return new Error('ERR index out of range');
                }
                cache[key][index] = element;
                return 'OK';
            })
            .thennx(function () { return new Error('ERR no such key'); })
            .end();
    };

    redismock.ltrim = function (key, start, end, callback) {
        return this
            .ifType(key, 'list', callback)
            .thenex(function () {
                var tmpS, tmpE;
                if (start > cache[key].length - 1 || start > end) {
                    cache[key] = new redismock.Array();
                }
                else {
                    if (start < 0 && end < 0) {
                        tmpE = cache[key].length + end;
                        tmpS = cache[key].length + start;
                        if (tmpS < 0) {
                            tmpS = 0;
                        }
                        start = tmpS;
                        end = tmpE;
                    }
                    if (end > cache[key].length - 1) {
                        end = cache[key].length - 1;
                    }
                    cache[key] = cache[key].slice(start, end + 1);
                }
            })
            .then(function () { 
                if (this.exists(key) && !cache[key].length) {
                    this.del(key);
                }
                return 'OK';
            })
            .end();
    };

    redismock.rpop = function (key, callback) {
        return this
            .ifType(key, 'list', callback)
            .thenex(function () { 
                var popped = cache[key].pop(); 
                if (!cache[key].length) {
                    this.del(key);
                }
                return popped;
            })
            .thennx(function () { return null; })
            .end();
    };

    redismock.rpoplpush = function (source, dest, callback) {
        var element = null, reply;
        if (this.exists(source) && this.type(source) !== 'list') {
            return wrongType(callback);
        }
        if (this.exists(dest) && this.type(dest) !== 'list') {
            return wrongType(callback);
        }
        element = this.rpop(source);
        if (element instanceof Error) {
            return cb(callback)(element);
        }
        if (element) {
            reply = this.lpush(dest, element);
            if (reply instanceof Error) {
                return cb(callback)(reply);
            }
        }
        return cb(callback)(null, element);
    };

    redismock.rpush = function (key, element, callback) {
        var g = gather(this.rpush).apply(this, arguments);
        callback = g.callback;
        return this
            .ifType(key, 'list', callback)
            .thennx(function () { cache[key] = new redismock.Array(); })
            .then(function () {
                cache[key] = cache[key].concat(g.list.slice(1));
                return cache[key].length;
            })
            .end();
    };

    redismock.rpushx = function (key, element, callback) {
        return this
            .ifType(key, 'list', callback)
            .thenex(function () {
                cache[key].push(element);
                return cache[key].length;
            })
            .thennx(function () { return 0; })
            .end();
    };

    // Set Commands
    // ------------

    redismock.sadd = function (key, member, callback) {
        var g = gather(this.sadd).apply(this, arguments);
        var count = 0;
        callback = g.callback;
        return this
            .ifType(key, 'set', callback)
            .thennx(function () { cache[sets][key] = {}; })
            .then(function () {
                g.list.slice(1).forEach(function (m) {
                    m = m ? m.toString() : '';
                    if (m.length === 0) {
                        return;
                    }
                    if (!(m in cache[sets][key])) {
                        cache[sets][key][m] = '';
                        count += 1;
                    }
                });
                return count;
            })
            .end();
    };

    redismock.scard = function (key, callback) {
        return this
            .ifType(key, 'set', callback)
            .thenex(function () { return Object.keys(cache[sets][key]).length; })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.sdiff = function (key, callback) {
        var that = this;
        var g = gather(this.sdiff).apply(this, arguments);
        callback = g.callback;
        if (!g.list.every(function (k) {
            return that.type(k) === 'set' || that.type(k) === 'none';
        })) {
            return wrongType(callback);
        }
        return this
            .ifType(key, 'set', callback)
            .thennx(function () {
                return [];
            })
            .thenex(function () {
                return g
                    .list
                    .slice(1)
                    .reduce(function (diff, k) {
                        return diff.filter(function (d) {
                            return !(d in cache[sets][k]);
                        });
                    }, this.smembers(g.list[0]));
            })
            .end();
    };
    
    redismock.sdiffstore = function (destination, key, callback) {
        var g = gather(this.sdiffstore).apply(this, arguments);
        var diff = this.sdiff.apply(this, g.list.slice(1));
        callback = g.callback;
        if (diff instanceof Error) {
            return cb(callback)(diff);
        }
        if (this.exists(destination)) {
            this.del(destination);
        }
        this.sadd.apply(this, [destination].concat(diff));
        return cb(callback)(null, diff.length);
    };

    redismock.sinter = function (key, callback) {
        var that = this;
        var g = gather(this.sinter).apply(this, arguments);
        callback = g.callback;
        if (!g.list.every(function (k) {
            return that.type(k) === 'set' || that.type(k) === 'none';
        })) {
            return wrongType(callback);
        }
        return this
            .ifType(key, 'set', callback)
            .thennx(function () {
                return [];
            })
            .thenex(function () {
                return g
                    .list
                    .slice(1)
                    .reduce(function (inter, k) {
                        return inter.filter(function (i) {
                            return i in cache[sets][k];
                        });
                    }, this.smembers(g.list[0]));
            })
            .end();
    };

    redismock.sinterstore = function (destination, key, callback) {
        var that = this;
        var g = gather(this.sinterstore).apply(this, arguments);
        var inter = this.sinter.apply(this, g.list.slice(1));
        callback = g.callback;
        if (inter instanceof Error) {
            return cb(callback)(inter);
        }
        if (this.exists(destination)) {
            this.del(destination);
        }
        inter.forEach(function (member) {
            that.sadd(destination, member);
        });
        return cb(callback)(null, inter.length);
    };

    redismock.sismember = function (key, member, callback) {
        return this
            .ifType(key, 'set', callback)
            .thenex(function () { return member in cache[sets][key] ? 1 : 0; })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.smembers = function (key, callback) {
        return this
            .ifType(key, 'set', callback)
            .thenex(function () { return Object.keys(cache[sets][key]); })
            .thennx(function () { return []; })
            .end();
    };

    redismock.smove = function (source, dest, member, callback) {
        var r, e;
        if (this.exists(source) && this.type(source) !== "set") {
            return wrongType(callback);
        }
        if (this.exists(dest) && this.type(dest) !== "set") {
            return wrongType(callback);
        }
        r = redismock.srem(source, member);
        if (r instanceof Error) {
            return cb(callback)(r);
        }
        if (r === 1) {
            e = redismock.sadd(dest, member);
            if (e instanceof Error) {
                return cb(callback)(e);
            }
        }
        return cb(callback)(null, r);
    };

    redismock.spop = function (key, callback) {
        var r;
        var rando = this.srandmember(key);
        if (rando instanceof Error) {
            return cb(callback)(rando);
        }
        r = this.srem(key, rando);
        if (r instanceof Error) {
            return cb(callback)(r);
        }
        return cb(callback)(null, rando);
    };

    redismock.srandmember = function (key, callback) {
        var that = this;
        var count;
        if (arguments.length === 2 && typeof callback !== "function") {
            count = callback;
            callback = null;
        }
        if (arguments.length === 3) {
            count = callback;
            callback = arguments[2];
        }
        return this
            .ifType(key, 'set', callback)
            .thenex(function () {
                var k = Object.keys(cache[sets][key]);
                var randos, rando;
                var len = that.scard(key);
                if (count === 0) {
                    return null;
                }
                if (count) {
                    randos = [];
                    while (randos.length < Math.abs(count)) {
                        rando = k[Math.floor(Math.random() * k.length)];
                        if (count < 0) {
                            randos.push(rando);
                        }
                        else {
                            if (randos.indexOf(rando) === -1) {
                                randos.push(rando);
                                if (randos.length === len) {
                                    break;
                                }
                            }
                        }
                    }
                    return randos;
                }
                return k[Math.floor(Math.random() * k.length)];
            })
            .thennx(function () { return null; })
            .end();
    };

    redismock.srem = function (key, member, callback) {
        var g = gather(this.srem).apply(this, arguments);
        var count = 0;
        callback = g.callback;
        return this
            .ifType(key, 'set', callback)
            .thenex(function () {
                g.list.slice(1).forEach(function (m) {
                    var k = m ? m.toString() : '';
                    if (k in cache[sets][key]) {
                        delete cache[sets][key][k];
                        count += 1;
                    }
                });
                if (!Object.keys(cache[sets][key]).length) {
                    this.del(key);
                }
            })
            .then(function () { return count; })
            .end();
    };

    redismock.sunion = function (key, callback) {
        var that = this;
        var g = gather(this.sunion).apply(this, arguments);
        callback = g.callback;
        if (!g.list.every(function (k) {
            return that.type(k) === 'set' || that.type(k) === 'none';
        })) {
            return wrongType(callback);
        }
        return this
            .ifType(key, 'set', callback)
            .thennx(function () {
                return [];
            })
            .thenex(function () {
                return Object
                    .keys(g
                          .list
                          .reduce(function (set, k) {
                              Object
                                  .keys(cache[sets][k])
                                  .filter(function (u) {
                                      return !(u in set);
                                  })
                                  .forEach(function (u) {
                                      set[u] = '';
                                  });
                              return set;
                          }, {}));
            })
            .end();
    };

    redismock.sunionstore = function (destination, key, callback) {
        var that = this;
        var g = gather(this.sunionstore).apply(this, arguments);
        var union = this.sunion.apply(this, g.list.slice(1));
        callback = g.callback;
        if (union instanceof Error) {
            return cb(callback)(union);
        }
        if (this.exists(destination)) {
            this.del(destination);
        }
        union.forEach(function (member) {
            that.sadd(destination, member);
        });
        return cb(callback)(null, union.length);
    };

    redismock.sscan = function (key, cursor, callback) {
        var g = gather(this.sscan).apply(this, arguments);
        var count, match;
        g
            .list
            .forEach(function (option, index) {
                if (option === 'count') {
                    count = g.list[index + 1];
                }
                if (option === 'match') {
                    match = new RegExp(translate(g.list[index + 1]));
                }
            });
        if (typeof count === 'undefined' || isNaN(parseInt(count, 10))) {
            count = 10;
        }
        callback = g.callback;
        return this
            .ifType(key, 'set', callback)
            .then(function () {
                var arr = [];
                this
                    .smembers(key)
                    .slice(cursor)
                    .some(function (member) {
                        if (typeof match === 'undefined' || member.match(match)) {
                            arr.push(member);
                        }
                        cursor += 1;
                        return arr.length >= count;
                    });
                if (!arr.length) {
                    cursor = 0;
                }
                return [cursor, arr];
            })
            .end();
    };

    // Sorted Set Commands
    // -------------------

    redismock.zadd = function (key, score, member, callback) {
        var g = gather(this.zadd).apply(this, arguments);
        callback = g.callback;
        g.list = g.list.slice(1);
        return this
            .ifType(key, 'zset', callback)
            .thennx(function () { cache[zsets][key] = redismock.SortedSet(); })
            .then(function () {
                var count = g
                    .list
                    .map(function (elem, index) {
                        if (index % 2 === 0) {
                            return [parseFloat(g.list[index]), g.list[index + 1]];
                        }
                        return null;
                    })
                    .filter(function (elem) {
                        return elem !== null;
                    })
                    .map(function (sm) {
                        return cache[zsets][key].add(sm[0], sm[1].toString());
                    })
                    .reduce(function (cnt, ret) {
                        return cnt + ret;
                    }, 0);
                return count;
            })
            .end();
    };

    redismock.zcard = function (key, callback) {
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () { 
                return cache[zsets][key].card;
            })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.zcount = function (key, min, max, callback) {
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                var count = cache[zsets][key]
                    .scores
                    .filter(function (score) {
                        return min <= score && score <= max;
                    })
                    .reduce(function (cnt, score) {
                        return cnt + cache[zsets][key].lengths[score];
                    }, 0);
                return count;
            })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.zincrby = function (key, increment, member, callback) {
        return this
            .ifType(key, 'zset', callback)
            .thennx(function () { cache[zsets][key] = redismock.SortedSet(); })
            .then(function () {
                var newScore, score;
                if (!exists(cache[zsets][key].invset[member])) {
                    this.zadd(key, increment, member);
                    return increment;
                }
                score = cache[zsets][key].invset[member];
                newScore = score + increment;
                this.zadd(key, newScore, member);
                return newScore;
            })
            .end();
    };

    redismock.zinterstore = function (destination, numkeys, key, callback) {
        var that = this;
        var g = gather(this.zinterstore).apply(this, arguments);
        var weights = {};
        var aggregate = 'sum';
        var count;
        callback = g.callback;
        if (!g.list.slice(2).every(function (k) {
            return that.type(k) === 'zset' || that.type(k) === 'none';
        })) {
            return wrongType(callback);
        }
        g.list.forEach(function (option, idx) {
            var index, weightsArray = [];
            if (option === 'weights') {
                index = idx + 1;
                while (g.list[index] !== 'aggregate' && index < g.list.length) {
                    weightsArray.push(g.list[index]);
                    index += 1;
                }
                weights = weightsArray.reduce(function (hash, weight, i) {
                    hash[g.list[i + 2]] = weight;
                    return hash;
                }, {});
            }
            else if (option === 'aggregate') {
                aggregate = g.list[idx + 1];
            }
        });
        if (this.exists(destination)) {
            this.del(destination);
        }
        count = 0;
        g.list = g.list.slice(2, 2 + numkeys);
        g
            .list
            .slice(1)
            .reduce(function (inter, k) {
                var arr = [];
                var idx, len = inter.length;
                var score, ms;
                for (idx = 0; idx < len; idx += 1) {
                    if (idx % 2 !== 0) {
                        continue;
                    }
                    score = cache[zsets][k].invset[inter[idx]];
                    if (!exists(score)) {
                        continue;
                    }
                    if (k in weights) {
                        score *= weights[k];
                    }
                    ms = [inter[idx + 1], inter[idx]];
                    if (aggregate === 'min') {
                        ms[0] = Math.min(ms[0], score);
                    }
                    else if (aggregate === 'max') {
                        ms[0] = Math.max(ms[0], score);
                    }
                    else { // === 'sum'
                        ms[0] += score;
                    }
                    arr.push(ms[1], ms[0]);
                }
                return arr;
            }, this.zrange(g.list[0], 0, -1, 'withscores').map(function (mors, index) {
                if (!(g.list[0] in weights)) {
                    return mors;
                }
                if (index % 2 === 0) {
                    return mors;
                }
                return mors*weights[g.list[0]];
            }))
            .forEach(function (mors, index, inter) {
                if (index % 2 !== 0) {
                    return;
                }
                that.zadd(destination, inter[index + 1], mors);
                count += 1;
            });
        return cb(callback)(null, count);
    };

    redismock.zlexcount = function (key, min, max, callback) {
        var r = this.zrangebylex(key, min, max);
        if (r instanceof Error) {
            return cb(callback)(r);
        }
        return cb(callback)(null, r.length);
    };

    redismock.zrange = function (key, start, stop, callback) {
        var withscores = false;
        if (typeof callback !== "function" && callback === "withscores") {
            withscores = true;
            callback = arguments[4];
        }
        if (start < 0) {
            start = Math.max(this.zcard(key) + start, 0);
        }
        if (stop < 0) {
            stop = this.zcard(key) + stop;
        }
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                var startScoreIdx = 0, idx = 0;
                var range = [];
                cache[zsets][key]
                    .sortScores()
                    .scores
                    .some(function (score) {
                        if (idx <= start && idx + cache[zsets][key].lengths[score] > start) {
                            return true;
                        }
                        idx += cache[zsets][key].set[score].length;
                        startScoreIdx += 1;
                        return false;
                    });
                cache[zsets][key]
                    .scores
                    .slice(startScoreIdx)
                    .some(function (score) {
                        var arr = [];
                        var len = cache[zsets][key].lengths[score];
                        var from = 0, to = 0;
                        if (idx > stop) {
                            return true;
                        }
                        while (idx < start) {
                            idx += 1;
                            from += 1;
                        }
                        to = from + 1;
                        while (idx <= stop && to <= len) {
                            idx += 1;
                            to += 1;
                        }
                        while (from < to) {
                            if (exists(cache[zsets][key].set[score][from])) {
                                arr.push(cache[zsets][key].set[score][from]);
                            }
                            from += 1;
                        }
                        arr.sort(function (a, b) {
                            return a.localeCompare(b);
                        });
                        if (withscores) {
                            arr = arr
                                .map(function (e) {
                                    return [e, score];
                                })
                                .reduce(function (flat, es) {
                                    return flat.concat(es);
                                }, []);
                        }
                        range = range.concat(arr);
                        return false;
                    });
                return range;
            })
            .thennx(function () { return []; })
            .end();
    };

    redismock.zrangebylex = function (key, min, max, callback) {
        function verify(r) {
            return typeof r === 'string' && (r.charAt(0) === '(' || r.charAt(0) === '[' || r.charAt(0) === '-' || r.charAt(0) === '+');
        }
        if (!verify(min) || !verify(max)) {
            return cb(callback)(new Error('ERR min or max not valid string range item'));
        }
        return this
            .ifType(key, 'zset', callback)
            .thennx(function () { return []; })
            .thenex(function () {
                var minStr = min.substr(1), maxStr = max.substr(1);
                var minInclusive = (min.charAt(0) === '['), maxInclusive = (max.charAt(0) === '[');
                var maxAll = (max.charAt(0) === '+');
                var range = [];
                if (min.charAt(0) === '+') {
                    return [];
                }
                if (max.charAt(0) === '-') {
                    return [];
                }
                cache[zsets][key]
                    .scores
                    .forEach(function (score) {
                        cache[zsets][key]
                            .set[score]
                            .forEach(function (member) {
                                if (!exists(member)) {
                                    return;
                                }
                                if (member > minStr && (member < maxStr || maxAll)) {
                                    range.push(member);
                                }
                                else if (member === minStr && minInclusive) {
                                    range.push(member);
                                }
                                else if (member === maxStr && maxInclusive) {
                                    range.push(member);
                                }
                            });
                    });
                range.sort(function (a, b) {
                    return a.localeCompare(b);
                });
                return range;
            })
            .end();
    };

    redismock.zrevrangebylex = function (key, max, min, callback) {
        var r = this.zrangebylex(key, min, max);
        if (r instanceof Error) {
            return cb(callback)(r);
        }
        return cb(callback)(null, r.reverse());
    };

    redismock.zrangebyscore = function (key, min, max, callback) {
        var withscores = false;
        var limitOffset = -1, limitCount = -1; 
        var idx, len;
        var arr = [], offset, count;
        var minInclusive = true, maxInclusive = true;
        if (typeof callback !== "function") {
            len = arguments.length;
            for (idx = 3; idx < len; idx += 1) {
                if (arguments[idx] === 'withscores') {
                    withscores = true;
                }
                if (typeof arguments[idx] === "function") {
                    callback = arguments[idx];
                }
                if (arguments[idx] === "limit") {
                    limitOffset = arguments[idx + 1];
                    limitCount = arguments[idx + 2];
                }
            }
        }
        if (min === '-inf') {
            min = Number.NEGATIVE_INFINITY;
        }
        if (min === '+inf') {
            min = Number.POSITIVE_INFINITY;
        }
        if (max === '-inf') {
            max = Number.NEGATIVE_INFINITY;
        }
        if (max === '+inf') {
            max = Number.POSITIVE_INFINITY;
        }
        if (min.toString().charAt(0) === '(') {
            minInclusive = false;
            min = parseFloat(min.toString().substr(1));
        }
        if (max.toString().charAt(0) === '(') {
            maxInclusive = false;
            max = parseFloat(max.toString().substr(1));
        }
        offset = 0;
        count = 0;
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                cache[zsets][key]
                    .sortScores()
                    .scores
                    .some(function (score) {
                        var memberArr = [], scoreArr = [], concatArr = [];
                        cache[zsets][key].set[score].some(function (member) {
                            if (!exists(member)) {
                                return;
                            }
                            // TODO: Re-work to scan scores to the right score, then start there.
                            if (((minInclusive && min <= score) || (!minInclusive && min < score)) && ((maxInclusive && score <= max) || (!maxInclusive && score < max))) {
                                if (limitOffset !== -1 && offset >= limitOffset) {
                                    if (limitCount !== -1) {
                                        if (count + memberArr.length < limitCount) {
                                            memberArr.push(member);
                                            if (withscores) {
                                                scoreArr.push(score);
                                            }
                                        }
                                        else {
                                            return true;
                                        }
                                    }
                                }
                                else if (limitOffset === -1) {
                                    memberArr.push(member);
                                    if (withscores) {
                                        scoreArr.push(score);
                                    }
                                }
                            }
                            offset += 1;
                            return false;
                        });
                        count += memberArr.length;
                        memberArr.sort(function (a, b) {
                            return a.localeCompare(b);
                        });
                        if (withscores) {
                            memberArr.forEach(function (m, idx) {
                                concatArr.push(m, scoreArr[idx]);
                            });
                        }
                        else {
                            concatArr = memberArr;
                        }
                        arr = arr.concat(concatArr);
                        if (limitCount !== -1 && count === limitCount) {
                            return true;
                        }
                        return false;
                    });
                return arr;
            })
            .thennx(function () { return []; })
            .end();
    };

    redismock.zrank = function (key, member, callback) {
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                var idx = 0;
                var found;
                cache[zsets][key].sortScores();
                found = cache[zsets][key]
                    .scores
                    .some(function (score) {
                        if (cache[zsets][key].set[score].indexOf(member) !== -1) {
                            return true;
                        }
                        idx += 1;
                        return false;
                    });
                if (!found) {
                    return null;
                }
                return idx;
            })
            .thennx(function () { return null; })
            .end();
    };

    redismock.zrem = function (key, member, callback) {
        var g = gather(this.zrem).apply(this, arguments);
        callback = g.callback;
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                var count = g
                    .list
                    .reduce(function (cnt, m) {
                        return cnt + cache[zsets][key].rem(m);
                    }, 0);
                if (cache[zsets][key].scores.length === 0) {
                    this.del(key);
                }
                return count;
            })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.zremrangebylex = function (key, min, max, callback) {
        var that = this;
        var range = this.zrangebylex(key, min, max);
        if (range instanceof Error) {
            return cb(callback)(range);
        }
        range.forEach(function (member) {
            that.zrem(key, member);
        });
        return cb(callback)(null, range.length);
    };

    redismock.zremrangebyrank = function (key, min, max, callback) {
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                var that = this;
                var idx, len = cache[zsets][key].scores.length, jdx, nel;
                var cnt;
                var score;
                var toRem = [];
                var card = this.zcard(key);
                if (min < 0) {
                    min = card + min;
                }
                if (max < 0) {
                    max = card + max;
                }
                cnt = 0;
                cache[zsets][key].sortScores();
                for (idx = 0; idx < len; idx += 1) {
                    score = cache[zsets][key].scores[idx];
                    nel = cache[zsets][key].set[score].length;
                    for (jdx = 0; jdx < nel; jdx += 1, cnt += 1) {
                        if (min <= cnt && cnt <= max) {
                            toRem.push(cache[zsets][key].set[score][jdx]);
                        }
                        if (cnt > max) {
                            break;
                        }
                    }
                    if (cnt > max) {
                        break;
                    }
                }
                toRem.forEach(function (r) {
                    that.zrem(key,r);
                });
                return toRem.length;
            })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.zremrangebyscore = function (key, min, max, callback) {
        var that = this;
        var range = this.zrangebyscore(key, min, max);
        if (range instanceof Error) {
            return cb(callback)(range);
        }
        range.forEach(function (member) {
            that.zrem(key, member);
        });
        return cb(callback)(null, range.length);
    };

    redismock.zrevrange = function (key, start, stop, callback) {
        var withscores = false;
        if (typeof callback !== "function" && callback === "withscores") {
            withscores = true;
            callback = arguments[4];
        }
        if (start < 0) {
            start = this.zcard(key) + start;
        }
        if (stop < 0) {
            stop = this.zcard(key) + stop;
        }
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                var startScoreIdx = 0, idx = 0;
                var range = [];
                cache[zsets][key]
                    .sortScoresRev()
                    .scores
                    .some(function (score) {
                        if (idx <= start && idx + cache[zsets][key].set[score].length > start) {
                            return true;
                        }
                        idx += cache[zsets][key].set[score].length;
                        startScoreIdx += 1;
                        return false;
                    });
                cache[zsets][key]
                    .scores
                    .slice(startScoreIdx)
                    .some(function (score) {
                        var arr = [];
                        var len = cache[zsets][key].set[score].length;
                        var from = 0, to = 0;
                        if (idx > stop) {
                            return true;
                        }
                        while (idx < start) {
                            idx += 1;
                            from += 1;
                        }
                        to = from + 1;
                        while (idx <= stop && to <= len) {
                            idx += 1;
                            to += 1;
                        }
                        arr = cache[zsets][key].set[score].slice(from, to);
                        arr.sort(function (a, b) {
                            return b.localeCompare(a);
                        });
                        if (withscores) {
                            arr = arr
                                .map(function (e) {
                                    return [e, score];
                                })
                                .reduce(function (flat, es) {
                                    return flat.concat(es);
                                }, []);
                        }
                        range = range.concat(arr);
                        return false;
                    });
                return range;
            })
            .thennx(function () { return []; })
            .end();
    };

    redismock.zrevrangebyscore = function (key, max, min, callback) {
        var g = gather(this.zrevrangebyscore).apply(this, arguments);
        var r, tmpM;
        callback = g.callback;
        tmpM = g.list[1];
        g.list[1] = g.list[2];
        g.list[2] = tmpM;
        r = this.zrangebyscore.apply(this, g.list);
        if (r instanceof Error) {
            return cb(callback)(r);
        }
        r.reverse();
        if (g.list.some(function (arg) {
            return arg === 'withscores';
        })) {
            r = r.map(function (e, idx) {
                if (idx % 2 === 0) {
                    return r[idx + 1];
                }
                return r[idx - 1];
            });
        }
        return cb(callback)(null, r);
    };

    redismock.zrevrank = function (key, member, callback) {
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                var idx, len = cache[zsets][key].scores.length, cnt;
                var score;
                cnt = 0;
                cache[zsets][key].sortScores();
                for (idx = len - 1; idx >= 0; idx -= 1, cnt += 1) {
                    score = cache[zsets][key].scores[idx];
                    if (cache[zsets][key].set[score].indexOf(member) !== -1) {
                        return cnt;
                    }
                }
                return null;
            })
            .thennx(function () { return null; })
            .end();
    };

    redismock.zscore = function (key, member, callback) {
        return this
            .ifType(key, 'zset', callback)
            .thenex(function () {
                var score = null;
                if (exists(cache[zsets][key].invset[member])) {
                    score = cache[zsets][key].invset[member];
                }
                return score;
            })
            .thennx(function () { return null; })
            .end();
    };

    redismock.zunionstore = function (destination, numkeys, key, callback) {
        var that = this;
        var g = gather(this.zunionstore).apply(this, arguments);
        var weights = {};
        var aggregate = 'sum';
        var count;
        callback = g.callback;
        if (!g.list.slice(2, 2 + numkeys).every(function (k) {
            return that.type(k) === 'zset' || that.type(k) === 'none';
        })) {
            return wrongType(callback);
        }
        g.list.forEach(function (option, idx) {
            var index, weightsArray = [];
            if (option === 'weights') {
                index = idx + 1;
                while (g.list[index] !== 'aggregate' && index < g.list.length) {
                    weightsArray.push(g.list[index]);
                    index += 1;
                }
                weights = weightsArray.reduce(function (hash, weight, i) {
                    hash[g.list[i + 2]] = weight;
                    return hash;
                }, {});
            }
            else if (option === 'aggregate') {
                aggregate = g.list[idx + 1];
            }
        });
        if (this.exists(destination)) {
            this.del(destination);
        }
        count = 0;
        g.list = g.list.slice(2, 2 + numkeys);
        g
            .list
            .slice(1)
            .reduce(function (union, k) {
                var arr = [];
                var idx, len = union.length;
                var score, ms;
                var hashk = cache[zsets][k].invset;
                var hashu = {};
                for (idx = 0; idx < len; idx += 1) {
                    if (idx % 2 !== 0) {
                        continue;
                    }
                    ms = [union[idx + 1], union[idx]];
                    score = cache[zsets][k].invset[union[idx]];
                    hashu[ms[1]] = ms[0];
                    if (!exists(score)) {
                        arr.push(ms[1], ms[0]);
                        continue;
                    }
                    if (k in weights) {
                        score *= weights[k];
                    }
                    if (aggregate === 'min') {
                        ms[0] = Math.min(ms[0], score);
                    }
                    else if (aggregate === 'max') {
                        ms[0] = Math.max(ms[0], score);
                    }
                    else { // === 'sum'
                        ms[0] += score;
                    }
                    arr.push(ms[1], ms[0]);
                }
                Object
                    .keys(hashk)
                    .forEach(function (member) {
                        if (!exists(hashk[member])) {
                            return;
                        }
                        if (!(member in hashu)) {
                            score = hashk[member];
                            if (k in weights) {
                                score *= weights[k];
                            }
                            arr.push(member, score);
                        }
                    });
                return arr;
            }, this.zrange(g.list[0], 0, -1, 'withscores').map(function (mors, index) {
                if (!(g.list[0] in weights)) {
                    return mors;
                }
                if (index % 2 === 0) {
                    return mors;
                }
                return mors*weights[g.list[0]];
            }))
            .forEach(function (mors, index, union) {
                if (index % 2 !== 0) {
                    return;
                }
                that.zadd(destination, union[index + 1], mors);
                count += 1;
            });
        return cb(callback)(null, count);
    };

    redismock.zscan = function (key, cursor, callback) {
        var g = gather(this.zscan).apply(this, arguments);
        var count, match;
        g
            .list
            .forEach(function (option, index) {
                if (option === 'count') {
                    count = g.list[index + 1];
                }
                if (option === 'match') {
                    match = new RegExp(translate(g.list[index + 1]));
                }
            });
        if (typeof count === 'undefined' || isNaN(parseInt(count, 10))) {
            count = 10;
        }
        callback = g.callback;
        return this
            .ifType(key, 'zset', callback)
            .then(function () {
                var arr = [];
                var cnt = 0;
                cache[zsets][key]
                    .sortScores()
                    .scores
                    .some(function (score) {
                        cache[zsets][key]
                            .set[score]
                            .some(function (member) {
                                if (cursor <= cnt) {
                                    if (typeof match === 'undefined' || member.match(match)) {
                                        arr.push([member, score]);
                                    }
                                    cursor += 1;
                                }
                                if (arr.length >= count) {
                                    return true;
                                }
                                cnt += 1;
                                return false;
                            });
                        if (arr.length >= count) {
                            return true;
                        }
                        return false;
                    });
                arr = arr.reduce(function (unnested, ms) {
                    return unnested.concat(ms);
                }, []);
                if (!arr.length) {
                    cursor = 0;
                }
                return [cursor, arr];
            })
            .end();
    };

    // Hash Commands
    // -------------

    redismock.hdel = function (key, field, callback) {
        var count = 0;
        var g = gather(this.hdel).apply(this, arguments);
        callback = g.callback;
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () {
                g.list.forEach(function (field) {
                    if (field in cache[hashes][key]) {
                        cache[hashes][key][field] = undefined;
                        count += 1;
                    }
                });
                if (Object.keys(cache[hashes][key]).length === 0) {
                    this.del(key);
                }
            })
            .then(function () { return count; })
            .end();
    };
    
    redismock.hexists = function (key, field,  callback) {
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () { return cache[hashes][key][field] !== undefined ? 1 : 0; })
            .thennx(function () { return 0; })
            .end();
    };

    redismock.hget = function (key, field, callback) {
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () { return cache[hashes][key][field]; })
            .thennx(function () { return null; })
            .end();
    };

    redismock.hgetall = function (key, callback) {
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () {
                var obj = Object
                    .keys(cache[hashes][key])
                    .map(function (field) {
                        return [field, cache[hashes][key][field]];
                    })
                    .reduce(function (prev, fv) {
                        prev[fv[0]] = fv[1];
                        return prev;
                    }, {});
                return obj;
            })
            .thennx(function () { return null; })
            .end();
    };

    redismock.hgetall_array = function (key, callback) {
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () {
                var arr = Object
                    .keys(cache[hashes][key])
                    .map(function (field) {
                        return [field, cache[hashes][key][field]];
                    })
                    .reduce(function (prev, fv) {
                        return prev.concat(fv);
                    }, []);
                return arr;
            })
            .thennx(function () { return []; })
            .end();
    };

    redismock.hincrby = function (key, field, increment, callback) {
        increment = parseInt(increment, 10);
        return this
            .ifType(key, 'hash', callback)
            .thennx(function () { cache[hashes][key] = {}; })
            .then(function () {
                var no;
                if (this.hexists(key, field) === 0) {
                    this.hset(key, field, increment);
                }
                else {
                    no = parseInt(this.hget(key, field), 10);
                    if (isNaN(no)) {
                        return new Error('ERR hash value is not an integer');
                    }
                    this.hset(key, field, no + increment);
                }
                return this.hget(key, field);
            })
            .end();
    };

    redismock.hincrbyfloat = function (key, field, increment, callback) {
        return this
            .ifType(key, 'hash', callback)
            .thennx(function () { cache[hashes][key] = {}; })
            .then(function () {
                var no;
                if (this.hexists(key, field) === 0) {
                    this.hset(key, field, increment);
                }
                else {
                    no = parseFloat(this.hget(key, field));
                    if (isNaN(no)) {
                        return new Error('ERR hash value is not a valid float');
                    }
                    this.hset(key, field, no + increment);
                }
                return this.hget(key, field);
            })
            .end();
    };

    redismock.hkeys = function (key, callback) {
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () { 
                return Object
                    .keys(cache[hashes][key])
                    .filter(function (f) {
                        return cache[hashes][key][f] !== undefined;
                    });
            })
            .thennx(function () { return []; })
            .end();
    };

    redismock.hlen = function (key, callback) {
        var r = this.hkeys(key);
        if (r instanceof Error) {
            return cb(callback)(r);
        }
        return cb(callback)(null, r.length);
    };

    redismock.hmget = function (key, field, callback) {
        var g = gather(this.hmget).apply(this, arguments);
        callback = g.callback;
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () {
                g.list = g.list.slice(1);
                var arr = g
                    .list
                    .map(function (f) {
                        return cache[hashes][key][f];
                    });
                return arr;
            })
            .thennx(function () { return []; })
            .end();
    };

    redismock.hmset = function (key, field, callback) {
        var g = gather(this.hmset).apply(this, arguments);
        callback = g.callback;
        return this
            .ifType(key, 'hash', callback)
            .thennx(function () { cache[hashes][key] = {}; })
            .then(function () {
                var that = this;
                var first = g.list[1];
                if (g.list.length === 2 && typeof first === 'object' && !(first instanceof Array)) {
                    Object
                        .keys(first)
                        .forEach(function(fv) {
                            that.hset(key, fv, first[fv]);
                        });
                } else {
                    g.list = g.list.slice(1);
                    g
                        .list
                        .map(function (fv, index) {
                            if (index % 2 === 0) {
                                return [fv, g.list[index + 1]];
                            }
                            return null;
                        })
                        .filter(function (fv) {
                            return fv !== null;
                        })
                        .forEach(function (fv) {
                            that.hset(key, fv[0], fv[1]);
                        });
                }
                return 'OK';
            })
            .end();
    };

    redismock.hset = function (key, field, value, callback) {
        var ret;
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () {
                if (field in cache[hashes][key] && cache[hashes][key][field] !== undefined) {
                    ret = 0;
                }
                else {
                    ret = 1;
                }
            })
            .thennx(function () {
                ret = 1;
                cache[hashes][key] = {}; 
            })
            .then(function () { 
                cache[hashes][key][field] = value;
                return ret; 
            })
            .end();
    };

    redismock.hsetnx = function (key, field, value, callback) {
        var ret;
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () {
                if (field in cache[hashes][key] && cache[hashes][key][field] !== undefined) {
                    ret = 0;
                    return;
                }
                ret = 1;
            })
            .thennx(function () {
                ret = 1;
                cache[hashes][key] = {};
            })
            .then(function () { 
                if (ret === 1) {
                    cache[hashes][key][field] = value;
                }
                return ret; 
            })
            .end();
    };

    redismock.hstrlen = function (key, field, callback) {
        return this
            .ifType(key, 'hash', callback)
            .thennx(function () { return 0; })
            .thenex(function () {
                if (!exists(cache[hashes][key][field])) {
                    return 0;
                }
                return (cache[hashes][key][field].toString()).length;
            })
            .end();
    };

    redismock.hvals = function (key, callback) {
        var vals = [];
        return this
            .ifType(key, 'hash', callback)
            .thenex(function () {
                vals = Object
                    .keys(cache[hashes][key])
                    .filter(function (field) {
                        return cache[hashes][key][field] !== undefined;
                    })
                    .map(function (field) {
                        return cache[hashes][key][field];
                    });
            })
            .then(function () { return vals; })
            .end();
    };

    redismock.hscan = function (key, cursor, callback) {
        var g = gather(this.hscan).apply(this, arguments);
        var count, match;
        g
            .list
            .forEach(function (option, index) {
                if (option === 'count') {
                    count = g.list[index + 1];
                }
                if (option === 'match') {
                    match = new RegExp(translate(g.list[index + 1]));
                }
            });
        if (typeof count === 'undefined' || isNaN(parseInt(count, 10))) {
            count = 10;
        }
        callback = g.callback;
        return this
            .ifType(key, 'hash', callback)
            .then(function () {
                var arr = [];
                this
                    .hgetall_array(key)
                    .slice(cursor*2)
                    .some(function (forv, index, hgetall) {
                        if (index % 2 !== 0) {
                            return false;
                        }
                        if (typeof match === 'undefined' || forv.match(match)) {
                            arr.push([forv, hgetall[index + 1]]);
                        }
                        cursor += 1;
                        return arr.length >= count;
                    });
                arr = arr.reduce(function (prev, fv) {
                    return prev.concat(fv);
                }, []);
                if (!arr.length) {
                    cursor = 0;
                }
                return [cursor, arr];
            })
            .end();

    };

    // Pub/Sub Commands
    // ----------------

    redismock.on = function (event, callback) {
        if (!exists(this.listeners)) {
            this.listeners = {};
        }
        if (!exists(this.listeners[event])) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
        return this;
    };
    function emit(rm, event) {
        var g = gather(emit).apply(null, arguments);
        if (exists(rm.listeners[event])) {
            rm.listeners[event]
                .forEach(function (cb) {
                    setImmediate(function () {
                        cb.apply(rm, g.list.slice(2));
                    });
                });
        }
    }

    function Subscriber(rm) {
        this.rm = rm;
        return this;
    }
    Subscriber.prototype.subscribe = function (channel) {
        this.channel = channel;
        emit(this.rm, "subscribe", channel, subscribers.length);
        return this;
    };
    Subscriber.prototype.psubscribe = function (pattern) {
        this.originalPattern = pattern;
        this.pattern = new RegExp(translate(pattern));
        emit(this.rm, "psubscribe", pattern, subscribers.length);
        return this;
    };
    Subscriber.prototype.matches = function (channel) {
        if (exists(this.channel) && this.channel === channel) {
            return true;
        }
        if (exists(this.pattern) && channel.match(this.pattern)) {
            return true;
        }
        return false;
    };
    Subscriber.prototype.message = function (channel, message) {
        if (this.matches(channel)) {
            if (exists(this.channel)) {
                emit(this.rm, "message", channel, message);
                return true;
            }
            else if (exists(this.pattern)) {
                emit(this.rm, "pmessage", this.originalPattern, channel, message);
                return true;
            }
        }
        return false;
    };
    Subscriber.prototype.unsubscribe = function (count) {
        if (exists(this.channel)) {
            emit(this.rm, "unsubscribe", this.channel, count);
        }
        if (exists(this.pattern)) {
            emit(this.rm, "punsubscribe", this.originalPattern, count);
        }
        return this;
    };

    redismock.psubscribe = function (pattern, callback) {
        var that = this;
        var g = gather(this.psubscribe).apply(this, arguments);
        callback = g.callback;
        g
            .list
            .forEach(function (pat) {
                subscribers.push((new Subscriber(that)).psubscribe(pat));
            });
        return cb(callback)(null, "OK");
    };

    redismock.pubsub = function (subcommand, callback) {
        var g = gather(this.pubsub).apply(this, arguments);
        var ret = null, pat;
        if (subcommand === "channels") {
            if (g.list[1]) {
                pat = new RegExp(translate(g.list[1]));
            }
            ret = subscribers
                .map(function (subscriber) {
                    if (exists(subscriber.channel) && (!pat || subscriber.channel.match(pat))) {
                        return subscriber.channel;
                    }
                    return null;
                })
                .filter(function (channel) {
                    return channel !== null;
                });
        }
        else if (subcommand === "numsub") {
            ret = g
                .list
                .slice(1)
                .map(function (channel) {
                    return subscribers
                        .reduce(function (count, subscriber) {
                            if (subscriber.channel === channel) {
                                return count + 1;
                            }
                            return count;
                        }, 0);
                })
                .reduce(function (flattened, cc) {
                    return flattened.concat(cc);
                }, []);
        }
        else if (subcommand === "numpat") {
            ret = subscribers
                .reduce(function (count, subscriber) {
                    if (exists(subscriber.pattern)) {
                        return count + 1;
                    }
                    return count;
                }, 0);
        }
        callback = g.callback;
        return cb(callback)(null, ret);
    };

    redismock.publish = function (channel, message, callback) {
        var count = subscribers
            .reduce(function (cnt, subscriber) {
                if (subscriber.message(channel.toString(), message.toString())) {
                    return cnt + 1;
                }
                return cnt;
            }, 0);
        return cb(callback)(null, count);
    };

    redismock.punsubscribe = function (callback) {
        var that = this;
        var g = gather(this.punsubscribe).apply(this, arguments);
        var newCount = subscribers.length;
        callback = g.callback;
        if (!g.list.length) {
            subscribers = subscribers
                .filter(function (subscriber) {
                    if (subscriber.rm !== that) {
                        return true;
                    }
                    if (exists(subscriber.pattern)) {
                        newCount -= 1;
                        subscriber.unsubscribe(newCount);
                    }
                    return !exists(subscriber.pattern);
                });
        }
        else {
            g
                .list
                .forEach(function (pattern) {
                    subscribers = subscribers
                        .filter(function (subscriber) {
                            if (subscriber.rm !== that) {
                                return true;
                            }
                            if (subscriber.originalPattern === pattern) {
                                newCount -= 1;
                                subscriber.unsubscribe(newCount);
                                return false;
                            }
                            return true;
                        });
                });
        }
        return cb(callback)(null, "OK");
    };

    redismock.subscribe = function (channel, callback) {
        var that = this;
        var g = gather(this.subscribe).apply(this, arguments);
        callback = g.callback;
        g
            .list
            .forEach(function (chan) {
                subscribers.push((new Subscriber(that)).subscribe(chan));
            });
        return cb(callback)(null, "OK");
    };

    redismock.unsubscribe = function (callback) {
        var that = this;
        var g = gather(this.unsubscribe).apply(this, arguments);
        var newCount = subscribers.length;
        callback = g.callback;
        if (!g.list.length) {
            subscribers = subscribers
                .filter(function (subscriber) {
                    if (subscriber.rm !== that) {
                        return true;
                    }
                    if (exists(subscriber.channel)) {
                        newCount -= 1;
                        subscriber.unsubscribe(newCount);
                    }
                    return !exists(subscriber.channel);
                });
        }
        else {
            g
                .list
                .forEach(function (chan) {
                    subscribers = subscribers
                        .filter(function (subscriber) {
                            if (subscriber.rm !== that) {
                                return true;
                            }
                            if (subscriber.channel === chan) {
                                newCount -= 1;
                                subscriber.unsubscribe(newCount);
                            }
                            return subscriber.channel !== chan;
                        });
                });
        }
        return cb(callback)(null, 'OK');
    };

    // Transactions Commands
    // ---------------------

    redismock.discard = function (callback) {
        return cb(callback)(new Error('ERR DISCARD without MULTI'));
    };

    redismock.multi = function (commands) {
        var rc = {};
        var that = this;
        var toApply = [], replies = [];
        if (exists(commands)) {
            toApply = toApply.concat(commands.map(function (command) {
                var args = command.slice(1);
                args.push(function (error, reply) {
                    if (error) {
                        replies.push(error.message);
                    }
                    else {
                        replies.push(reply);
                    }
                });
                return [command[0], that[command[0]], that, args];
            }));
        }
        Object.keys(this).forEach(function (key) {
            rc[key] = function () {
                var args = Array.prototype.slice.call(arguments);
                args.push(function (error, reply) {
                    if (error) {
                        replies.push(error.message);
                    }
                    else {
                        replies.push(reply);
                    }
                });
                toApply.push([key, that[key], that, args]);
                return this;
            };
        });
        rc.exec = function (callback) {
            if (toApply.some(function (apply) {
                var check = apply[3][0];
                if (exists(watchers[check]) && watchers[check].modified && watchers[check].watchers.indexOf(that) !== -1) {
                    // FAIL! One of the keys has been modified.
                    return true;
                }
                // TODO: Multi-keyed commands.
                return false;
            })) {
                that.unwatch();
                return cb(callback)(null, null);
            }
            toApply.forEach(function (apply) {
                apply[1].apply(apply[2], apply[3]);
            });
            that.unwatch();
            return cb(callback)(null, replies);
        };
        rc.discard = function (callback) {
            toApply = [];
            that.unwatch();
            return cb(callback)(null, 'OK');
        };
        return rc;
    };

    redismock.unwatch = function (callback) {
        var that = this;
        Object
            .keys(watchers)
            .forEach(function (k) {
                if (exists(watchers[k])) {
                    watchers[k].watchers = watchers[k].watchers.filter(function (mock) {
                        return that !== mock;
                    });
                    if (watchers[k].watchers.length === 0) {
                        watchers[k] = undefined;
                    }
                }
            });
        return cb(callback)(null, 'OK');
    };

    redismock.watch = function (key, callback) {
        if (!exists(watchers[key])) {
            watchers[key] = {
                modified: false,
                watchers: []
            };
        }
        watchers[key].watchers.push(this);
        return cb(callback)(null, 'OK');
    };

    // Scripting Commands
    // ------------------

    /* jshint ignore:start */
    redismock.eval = function (script, numkeys, key, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };
    /* jshint ignore:end */

    redismock.evalsha = function (sha1, numkeys, key, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.script_exists = function (script, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.script_flush = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.script_kill = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.script_load = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    // Connection Commands
    // -------------------

    redismock.auth = function (password, callback) {
        if (!redismock.password) {
            return cb(callback)(new Error('ERR Client sent AUTH, but no password is set'));
        }
        if (password === redismock.password ) {
            return cb(callback)(null, 'OK');
        }
        return cb(callback)(new Error('ERR invalid password'));
    };

    redismock.echo = function (message, callback) {
        return cb(callback)(null, message);
    };

    redismock.ping = function (callback) {
        return cb(callback)(null, "PONG");
    };

    redismock.quit = function (callback) {
        return cb(callback)(null, "OK");
    };

    redismock.select = function (index, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.createClient = function () {
        return redismock.copy();
    };

    // Server Commands
    // ---------------

    redismock.bgrewriteaof = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.bgsave = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.client_kill = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.client_list = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.client_getname = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.client_pause = function (timeout, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.client_setname = function (connection_name, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.cluster_slots = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.command = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.command_count = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.command_getkeys = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.command_info = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.config_get = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.config_rewrite = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.config_set = function (parameter, value, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.config_resetstat = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.dbsize = function (callback) {
        var count = 0, key;
        for (key in cache) {
            if (key === sets || key === zsets || key === hashes) {
                continue;
            }
            if (cache.hasOwnProperty(key)) {
                count += 1;
            }
        }
        for (key in cache[sets]) {
            if (cache[sets].hasOwnProperty(key)) {
                count += 1;
            }
        }
        for (key in cache[zsets]) {
            if (cache[zsets].hasOwnProperty(key)) {
                count += 1;
            }
        }
        for (key in cache[hashes]) {
            if (cache[hashes].hasOwnProperty(key)) {
                count += 1;
            }
        }
        return cb(callback)(null, count);
    };

    redismock.debug_object = function (key, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.debug_segfault = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.flushall = function (callback) {
        // TODO: right now, just flushdb, but in the future, flush all dbs.
        return this.flushdb(callback);
    };

    redismock.flushdb = function (callback) {
        cache = {};
        cache[sets] = {};
        cache[zsets] = {};
        cache[hashes] = {};
        Object.keys(timeouts).forEach(function (key) {
            if (timeouts[key]) {
                clearTimeout(timeouts[key].timeout);
            }
        });
        timeouts = {};
        return cb(callback)(null, 'OK');
    };

    redismock.info = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.lastsave = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.monitor = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.role = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.save = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.shutdown = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.slaveof = function (host, port, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.slowlog = function (subcommand, callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.sync = function (callback) {
        return cb(callback)(new Error('UNIMPLEMENTED'));
    };

    redismock.time = function (callback) {
        var now = new Date();
        var epoch = now.getTime();
        var us;
        if (root.performance) {
            if (root.performance.now) {
                now = root.performance.now();
                us = (now - Math.floor(now)) * 100000;
            }
            else if (root.performance.webkitNow) {
                now = root.performance.webkitNow();
                us = (now - Math.floor(now)) * 100000;
            }
            else {
                us = 0;
            }
        }
        else if (typeof process !== 'undefined' && process.hrtime) {
            us = process.hrtime()[1] / 1000;
        }
        else {
            us = 0;
        }
        return cb(callback)(null, [epoch, us]); 
    };

    // Modifications
    // -------------

    var modifiers = ['del', 'mset', 'msetnx', 'psetex', 'set', 'setbit', 'setex', 'setrange', 'incr', 'decr', 'incrby', 'decrby', 'incrbyfloat', 'blpop', 'brpop', 'brpoplpush', 'linsert', 'lpush', 'lpushx', 'rpush', 'rpushx', 'lpop', 'rpop', 'rpoplpush', 'ltrim', 'lset', 'lrem', 'sadd', 'smove', 'spop', 'sdiffstore', 'sinterstore', 'srem', 'sunionstore', 'zadd', 'zrem', 'zunionstore', 'zinterstore', 'zincrby', 'zremrangebylex', 'zremrangebyrank', 'zremrangebyscore', 'hdel', 'hincrby', 'hincrbyfloat', 'hset', 'hmset', 'hsetnx']; // TODO: Add the rest.
    var capture = {};
    var fkeys = [];
    for (var key in redismock) {
        if (typeof redismock[key] === "function") {
            fkeys.push(key);
            capture[key] = redismock[key];
        }
    }
    // Have each function check its formal parameter list against its argument length
    // and return an error if there are not enough arguments;
    fkeys.forEach(function (key) {
        redismock[key] = function () {
            if (arguments.length < capture[key].length - 1) {
                return cb(arguments[arguments.length - 1])(new Error('ERR wrong number of arguments for \'' + key + '\' command'));
            }
            return capture[key].apply(this, arguments);
        };
    });
    // For each function that modifies the database, splice in the watchers to get
    // the modification and potentially not execute a multi.
    modifiers.forEach(function (modifier) {
        var mod = redismock[modifier];
        redismock[modifier] = function () {
            var key = arguments[0];
            if (exists(watchers[key])) {
                watchers[key].modified = true;
            }
            // TODO: Multi-key commands.
            return mod.apply(this, arguments);
        };
    });
    function toPromise(f, context, deferFactory) {
        return function () {
            // Remove the formal callback parameter and make it a promise instead.
            var args = Array.prototype.slice.call(arguments);
            var deferred = deferFactory(), promise;
            var callback;
            while (args.length < f.length - 1) {
                args.push(undefined);
            }
            if (typeof args[args.length - 1] === 'function') {
                // Hm, someone passed in the callback, so we should probably honor it when we can.
                callback = args[args.length - 1];
                args.pop();
            }
            args.push(function (err, reply) {
                if (err) {
                    if (callback && typeof callback === 'function') {
                        callback(err);
                    }
                    return deferred.reject(err);
                }
                if (callback && typeof callback === 'function') {
                    callback(null, reply);
                }
                deferred.resolve(reply);
            });
            f.apply(context, args);
            promise = deferred.promise;
            if (typeof promise === 'function') {
                promise = promise();
            }
            return promise;
        };
    }
    redismock.toPromiseStyle = function (deferFactory) {
        var that = this;
        return Object
            .keys(this)
            .filter(function (key) {
                return typeof that[key] === 'function' && key !== 'multi';
            })
            .map(function (key) {
                return [key, toPromise(that[key], that, deferFactory)];
            })
            .reduce(function (promised, f) {
                promised[f[0]] = f[1];
                return promised;
            }, {multi: this.multi});
    };

    redismock.copy = function () {
        var copied = {};
        fkeys.forEach(function (key) {
            copied[key] = function () {
                return redismock[key].apply(copied, arguments);
            };
        });
        copied.toPromiseStyle = redismock.toPromiseStyle;
        copied.listeners = {};
        return copied;
    };

    redismock.toNodeRedis = function () {
        if (typeof require !== 'function') {
            return redismock;
        }
        var redis = require('redis');
        var client = redis.createClient.apply(redis, arguments);
        var rc = redismock.copy();
        var key, keys = [];
        for (key in client) {
            if (typeof client[key] === 'function') {
                keys.push(key);
            }
        }
        keys.forEach(function (k) {
            rc[k] = function () {
                return client[k].apply(client, arguments);
            };
        });
        rc.createClient = function () {
            return redismock.toNodeRedis.apply(rc, arguments);
        };
        return rc;
    };

    redismock.unref = function () {
      // noop, but required for API compatibility
    };

    if (typeof process !== 'undefined' && process.env.REDIS_JS_TO_NODE_REDIS === '1') {
        var asNodeRedis;
        var node_redis_args = [];
        if (process.env.REDIS_JS_NODE_REDIS_PORT) {
            node_redis_args.push(process.env.REDIS_JS_NODE_REDIS_PORT);
        }
        if (process.env.REDIS_JS_NODE_REDIS_HOST) {
            node_redis_args.push(process.env.REDIS_JS_NODE_REDIS_HOST);
        }
        if (process.env.REDIS_JS_NODE_REDIS_OPTIONS) {
            node_redis_args.push(JSON.parse(process.env.REDIS_JS_NODE_REDIS_OPTIONS));
        }
        asNodeRedis = redismock.toNodeRedis.apply(redismock, node_redis_args);
        if (typeof exports !== 'undefined') {
            if (typeof module !== 'undefined' && module.exports) {
                exports = module.exports = asNodeRedis;
            }
            exports.redismock = asNodeRedis;
        } 
        else {
            root.redismock = asNodeRedis;
        }
    }

}).call(this);
