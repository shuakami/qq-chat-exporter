# frac

Rational approximation to a floating point number with bounded denominator.

Uses the [Mediant Method](https://en.wikipedia.org/wiki/Mediant_method).

This module also provides an implementation of the continued fraction method as
described by Aberth in "A method for exact computation with rational numbers".
The algorithm is used in <a href="http://sheetjs.com">SheetJS Libraries</a> to
replicate fraction formats.

## Installation

### JS

With [`npm`](https://www.npmjs.org/package/frac):

```bash
$ npm install frac
```

In the browser:

```html
<script src="frac.js"></script>
```

The script will manipulate `module.exports` if available .  This is not always
desirable.  To prevent the behavior, define `DO_NOT_EXPORT_FRAC`

### Python

From [`PyPI`](https://pypi.python.org/pypi/frac):

```bash
$ pip install frac
```

## Usage

In all cases, the relevant function takes 3 arguments:

 - `x` the number we wish to approximate
 - `D` the maximum denominator
 - `mixed` if true, return a mixed fraction; if false, improper

The return value is an array of the form `[quot, num, den]` where `quot==0`
for improper fractions.  `quot <= x` for mixed fractions, which may lead to some
unexpected results when rendering negative numbers.

### JS

The exported `frac` function implements the Mediant method.

`frac.cont` implements the Aberth algorithm

For example:

```js
> // var frac = require('frac'); // uncomment this line if in node
> frac(1.3, 9);              // [  0,  9, 7 ] //  1.3 ~       9/7
> frac(1.3, 9, true);        // [  1,  2, 7 ] //  1.3 ~  1 +  2/7
> frac(-1.3, 9);             // [  0, -9, 7 ] // -1.3 ~      -9/7
> frac(-1.3, 9, true);       // [ -2,  5, 7 ] // -1.3 ~ -2 +  5/7

> frac.cont(1.3, 9);         // [  0,  4, 3 ] //  1.3 ~       4/3
> frac.cont(1.3, 9, true);   // [  1,  1, 3 ] //  1.3 ~  1 +  1/3
> frac.cont(-1.3, 9);        // [  0, -4, 3 ] // -1.3 ~      -4/3
> frac.cont(-1.3, 9, true);  // [ -2,  2, 3 ] // -1.3 ~ -2 +  2/3
```


### Python

`frac.med` implements Mediant method.

`frac.cont` implements Aberth algorithm.

For example:

```py
>>> import frac
>>> frac.med(1.3, 9)         ## [  0,  9, 7 ] ##  1.3 ~       9/7
>>> frac.med(1.3, 9, True)   ## [  1,  2, 7 ] ##  1.3 ~  1 +  2/7
>>> frac.med(-1.3, 9)        ## [  0, -9, 7 ] ## -1.3 ~      -9/7
>>> frac.med(-1.3, 9, True)  ## [ -2,  5, 7 ] ## -1.3 ~ -2 +  5/7

>>> frac.cont(1.3, 9)        ## [  0,  4, 3 ] ##  1.3 ~       4/3
>>> frac.cont(1.3, 9, True)  ## [  1,  1, 3 ] ##  1.3 ~  1 +  1/3
>>> frac.cont(-1.3, 9)       ## [  0, -4, 3 ] ## -1.3 ~      -4/3
>>> frac.cont(-1.3, 9, True) ## [ -2,  2, 3 ] ## -1.3 ~ -2 +  2/3
```

## Testing

The test TSV baselines in the `test_files` directory have four columns:

- Column A contains the raw values
- Column B format "Up to one digit (1/4)" (`denominator = 9`)
- Column C format "Up to two digits (21/25)" (`denominator = 99`)
- Column D format "Up to three digits (312/943)" (`denominator = 999`)

`make test` will run the node-based tests.

`make pytest` will run the python tests against the system Python version.

`make pypytest` will run the python tests against `pypy` if installed

## License

Please consult the attached LICENSE file for details.  All rights not explicitly
granted by the Apache 2.0 License are reserved by the Original Author.

## Badges

[![Build Status](https://saucelabs.com/browser-matrix/frac.svg)](https://saucelabs.com/u/frac)

[![Build Status](https://travis-ci.org/SheetJS/frac.svg?branch=master)](https://travis-ci.org/SheetJS/frac)

[![Coverage Status](http://img.shields.io/coveralls/SheetJS/frac/master.svg)](https://coveralls.io/r/SheetJS/frac?branch=master)

[![NPM Downloads](https://img.shields.io/npm/dt/frac.svg)](https://npmjs.org/package/frac)

[![Dependencies Status](https://david-dm.org/sheetjs/frac/status.svg)](https://david-dm.org/sheetjs/frac)

[![ghit.me](https://ghit.me/badge.svg?repo=sheetjs/js-xlsx)](https://ghit.me/repo/sheetjs/js-xlsx)

[![Analytics](https://ga-beacon.appspot.com/UA-36810333-1/SheetJS/frac?pixel)](https://github.com/SheetJS/frac)
