# adler32

Signed ADLER-32 algorithm implementation in JS (for the browser and nodejs).
Emphasis on correctness, performance, and IE6+ support.

## Installation

With [npm](https://www.npmjs.org/package/adler-32):

```bash
$ npm install adler-32
```

In the browser:

```html
<script src="adler32.js"></script>
```

The browser exposes a variable `ADLER32`.

When installed globally, npm installs a script `adler32` that computes the
checksum for a specified file or standard input.

The script will manipulate `module.exports` if available .  This is not always
desirable.  To prevent the behavior, define `DO_NOT_EXPORT_ADLER`.

## Usage

In all cases, the relevant function takes an argument representing data and an
optional second argument representing the starting "seed" (for running hash).

The return value is a signed 32-bit integer.

- `ADLER32.buf(byte array or buffer[, seed])` assumes the argument is a sequence
  of 8-bit unsigned integers (nodejs `Buffer`, `Uint8Array` or array of bytes).

- `ADLER32.bstr(binary string[, seed])` assumes the argument is a binary string
  where byte `i` is the low byte of the UCS-2 char: `str.charCodeAt(i) & 0xFF`

- `ADLER32.str(string)` assumes the argument is a standard JS string and
  calculates the hash of the UTF-8 encoding.

For example:

```js
// var ADLER32 = require('adler-32');           // uncomment if in node
ADLER32.str("SheetJS")                          // 176947863
ADLER32.bstr("SheetJS")                         // 176947863
ADLER32.buf([ 83, 104, 101, 101, 116, 74, 83 ]) // 176947863

adler32 = ADLER32.buf([83, 104])                // 17825980  "Sh"
adler32 = ADLER32.str("eet", adler32)           // 95486458  "Sheet"
ADLER32.bstr("JS", adler32)                     // 176947863  "SheetJS"

[ADLER32.str("\u2603"),  ADLER32.str("\u0003")]  // [ 73138686, 262148 ]
[ADLER32.bstr("\u2603"), ADLER32.bstr("\u0003")] // [ 262148,   262148 ]
[ADLER32.buf([0x2603]),  ADLER32.buf([0x0003])]  // [ 262148,   262148 ]
```

## Testing

`make test` will run the nodejs-based test.

To run the in-browser tests, run a local server and go to the `ctest` directory.
`make ctestserv` will start a python `SimpleHTTPServer` server on port 8000.

To update the browser artifacts, run `make ctest`.

To generate the bits file, use the `adler32` function from python `zlib`:

```python
>>> from zlib import adler32
>>> x="foo bar baz٪☃🍣"
>>> adler32(x)
1543572022
>>> adler32(x+x)
-2076896149
>>> adler32(x+x+x)
2023497376
```

The [`adler32-cli`](https://www.npmjs.com/package/adler32-cli) package includes
scripts for processing files or text on standard input:

```bash
$ echo "this is a test" > t.txt
$ adler32-cli t.txt
726861088
```

For comparison, the `adler32.py` script in the subdirectory uses python `zlib`:

```bash
$ packages/adler32-cli/bin/adler32.py t.txt
726861088
```

## Performance

`make perf` will run algorithmic performance tests (which should justify certain
decisions in the code).

Bit twiddling is much faster than taking the mod in Safari and Firefox browsers.
Instead of taking the literal mod 65521, it is faster to keep it in the integers
by bit-shifting: `65536 ~ 15 mod 65521` so for nonnegative integer `a`:

```
    a = (a >>> 16) * 65536 + (a & 65535)            [equality]
    a ~ (a >>> 16) * 15    + (a & 65535) mod 65521
```

The mod is taken at the very end, since the intermediate result may exceed 65521

## Magic Number

The magic numbers were chosen so as to not overflow a 31-bit integer:

```mathematica
F[n_] := Reduce[x*(x + 1)*n/2 + (x + 1)*(65521) < (2^31 - 1) && x > 0, x, Integers]
F[255] (* bstr:  x \[Element] Integers && 1 <= x <= 3854 *)
F[127] (* ascii: x \[Element] Integers && 1 <= x <= 5321 *)
```

Subtract up to 4 elements for the Unicode case.

## License

Please consult the attached LICENSE file for details.  All rights not explicitly
granted by the Apache 2.0 license are reserved by the Original Author.

## Badges

[![Sauce Test Status](https://saucelabs.com/browser-matrix/adler32.svg)](https://saucelabs.com/u/adler32)

[![Build Status](https://img.shields.io/github/workflow/status/sheetjs/js-adler32/Tests:%20node.js)](https://github.com/SheetJS/js-adler32/actions)

[![Coverage Status](http://img.shields.io/coveralls/SheetJS/js-adler32/master.svg)](https://coveralls.io/r/SheetJS/js-adler32?branch=master)

[![Analytics](https://ga-beacon.appspot.com/UA-36810333-1/SheetJS/js-adler32?pixel)](https://github.com/SheetJS/js-adler32)
