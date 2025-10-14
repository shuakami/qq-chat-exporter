# js-codepage

[Codepages](https://en.wikipedia.org/wiki/Codepage) are character encodings.  In
many contexts, single- or double-byte character sets are used in lieu of Unicode
encodings.  The codepages map between characters and numbers.

## Setup

In node:

```js
var cptable = require('codepage');
```

In the browser:

```html
<script src="cptable.js"></script>
<script src="cputils.js"></script>
```

Alternatively, use the full version in the dist folder:

```html
<script src="cptable.full.js"></script>
```

The complete set of codepages is large due to some Double Byte Character Set
encodings.  A much smaller file that only includes SBCS codepages is provided in
this repo (`sbcs.js`), as well as a file for other projects (`cpexcel.js`)

If you know which codepages you need, you can include individual scripts for
each codepage.  The individual files are provided in the `bits/` directory.
For example, to include only the Mac codepages:

```html
<script src="bits/10000.js"></script>
<script src="bits/10006.js"></script>
<script src="bits/10007.js"></script>
<script src="bits/10029.js"></script>
<script src="bits/10079.js"></script>
<script src="bits/10081.js"></script>
```

All of the browser scripts define and append to the `cptable` object.  To rename
the object, edit the `JSVAR` shell variable in `make.sh` and run the script.

The utilities functions are contained in `cputils.js`, which assumes that the
appropriate codepage scripts were loaded.

The script will manipulate `module.exports` if available .  This is not always
desirable.  To prevent the behavior, define `DO_NOT_EXPORT_CODEPAGE`.

## Usage

Most codepages are indexed by number.  To get the Unicode character for a given
codepoint, use the `dec` property:

```js
var unicode_cp10000_255 = cptable[10000].dec[255]; // ˇ
```

To get the codepoint for a given character, use the `enc` property:

```js
var cp10000_711 = cptable[10000].enc[String.fromCharCode(711)]; // 255
```

There are a few utilities that deal with strings and buffers:

```js
var 汇总 = cptable.utils.decode(936, [0xbb,0xe3,0xd7,0xdc]);
var buf =  cptable.utils.encode(936,  汇总);
var sushi= cptable.utils.decode(65001, [0xf0,0x9f,0x8d,0xa3]); // 🍣
var sbuf = cptable.utils.encode(65001, sushi);
```

`cptable.utils.encode(CP, data, ofmt)` accepts a String or Array of characters
and returns a representation controlled by `ofmt`:

- Default output is a Buffer (or Array) of bytes (integers between 0 and 255)
- If `ofmt == 'str'`, return a binary String (byte `i` is `o.charCodeAt(i)`)
- If `ofmt == 'arr'`, return an Array of bytes

`cptable.utils.decode(CP, data)` accepts a byte String or Array of numbers or
Buffer and returns a JS string.

## Known Excel Codepages

A much smaller script, including only the codepages known to be used in Excel,
is available under the name `cpexcel`.  It exposes the same variable `cptable`
and is suitable as a drop-in replacement when the full codepage tables are not
needed.

In node:

```js
var cptable = require('codepage/dist/cpexcel.full');
```

## Rolling your own script

The `make.sh` script in the repo can take a manifest and generate JS source.

Usage:

```bash
$ bash make.sh path_to_manifest output_file_name JSVAR
```

where

- `JSVAR` is the name of the exported variable (generally `cptable`)
- `output_file_name` is the output file (`cpexcel.js`, `cptable.js`, ...)
- `path_to_manifest` is the path to the manifest file.

The manifest file is expected to be a CSV with 3 columns:

```
<codepage number>,<source>,<size>
```

If a source is specified, it will try to download the specified file and parse.
The file format is expected to follow the format from the unicode.org site.
The size should be `1` for a single-byte codepage and `2` for a double-byte
codepage.  For mixed codepages (which use some single- and some double-byte
codes), the script assumes the mapping is a prefix code and generates efficient
JS code.

Generated scripts only include the mapping.  `cat` a mapping with `cputils.js`
to produce a complete script like `cpexcel.full.js`.

## Building the complete script

This script uses [voc](npm.im/voc).  The script to build the codepage tables and
the JS source is `codepage.md`, so building involves `voc codepage.md`.

## Generated Codepages

The complete list of codepages can be found in the file `pages.csv`.

Some codepages are easier to implement algorithmically.  Since those character
tables are not generated, there is no corresponding entry (they are "magic").

|   CP#   |   Source    | Description                                          |
|--------:|:-----------:|:-----------------------------------------------------|
| `   37` | unicode.org | IBM EBCDIC US-Canada                                 |
| `  437` | unicode.org | OEM United States                                    |
| `  500` | unicode.org | IBM EBCDIC International                             |
| `  620` |     NLS     | Mazovia (Polish) MS-DOS                              |
| `  708` |  Windows 7  | Arabic (ASMO 708)                                    |
| `  720` |  Windows 7  | Arabic (Transparent ASMO); Arabic (DOS)              |
| `  737` | unicode.org | OEM Greek (formerly 437G); Greek (DOS)               |
| `  775` | unicode.org | OEM Baltic; Baltic (DOS)                             |
| `  808` | unicode.org | OEM Russian; Cyrillic + Euro symbol                  |
| `  850` | unicode.org | OEM Multilingual Latin 1; Western European (DOS)     |
| `  852` | unicode.org | OEM Latin 2; Central European (DOS)                  |
| `  855` | unicode.org | OEM Cyrillic (primarily Russian)                     |
| `  857` | unicode.org | OEM Turkish; Turkish (DOS)                           |
| `  858` |  Windows 7  | OEM Multilingual Latin 1 + Euro symbol               |
| `  860` | unicode.org | OEM Portuguese; Portuguese (DOS)                     |
| `  861` | unicode.org | OEM Icelandic; Icelandic (DOS)                       |
| `  862` | unicode.org | OEM Hebrew; Hebrew (DOS)                             |
| `  863` | unicode.org | OEM French Canadian; French Canadian (DOS)           |
| `  864` | unicode.org | OEM Arabic; Arabic (864)                             |
| `  865` | unicode.org | OEM Nordic; Nordic (DOS)                             |
| `  866` | unicode.org | OEM Russian; Cyrillic (DOS)                          |
| `  869` | unicode.org | OEM Modern Greek; Greek, Modern (DOS)                |
| `  870` |  Windows 7  | IBM EBCDIC Multilingual/ROECE (Latin 2)              |
| `  872` | unicode.org | OEM Cyrillic (primarily Russian) + Euro Symbol       |
| `  874` | unicode.org | Windows Thai                                         |
| `  875` | unicode.org | IBM EBCDIC Greek Modern                              |
| `  895` |     NLS     | Kamenický (Czech) MS-DOS                             |
| `  932` | unicode.org | Japanese Shift-JIS                                   |
| `  936` | unicode.org | Simplified Chinese GBK                               |
| `  949` | unicode.org | Korean                                               |
| `  950` | unicode.org | Traditional Chinese Big5                             |
| ` 1010` |     IBM     | IBM EBCDIC French                                    |
| ` 1026` | unicode.org | IBM EBCDIC Turkish (Latin 5)                         |
| ` 1047` |  Windows 7  | IBM EBCDIC Latin 1/Open System                       |
| ` 1132` |     IBM     | IBM EBCDIC Lao (1132 / 1133 / 1341)                  |
| ` 1140` |  Windows 7  | IBM EBCDIC US-Canada (037 + Euro symbol)             |
| ` 1141` |  Windows 7  | IBM EBCDIC Germany (20273 + Euro symbol)             |
| ` 1142` |  Windows 7  | IBM EBCDIC Denmark-Norway (20277 + Euro symbol)      |
| ` 1143` |  Windows 7  | IBM EBCDIC Finland-Sweden (20278 + Euro symbol)      |
| ` 1144` |  Windows 7  | IBM EBCDIC Italy (20280 + Euro symbol)               |
| ` 1145` |  Windows 7  | IBM EBCDIC Latin America-Spain (20284 + Euro symbol) |
| ` 1146` |  Windows 7  | IBM EBCDIC United Kingdom (20285 + Euro symbol)      |
| ` 1147` |  Windows 7  | IBM EBCDIC France (20297 + Euro symbol)              |
| ` 1148` |  Windows 7  | IBM EBCDIC International (500 + Euro symbol)         |
| ` 1149` |  Windows 7  | IBM EBCDIC Icelandic (20871 + Euro symbol)           |
| ` 1200` |    magic    | Unicode UTF-16, little endian (BMP of ISO 10646)     |
| ` 1201` |    magic    | Unicode UTF-16, big endian                           |
| ` 1250` | unicode.org | Windows Central Europe                               |
| ` 1251` | unicode.org | Windows Cyrillic                                     |
| ` 1252` | unicode.org | Windows Latin I                                      |
| ` 1253` | unicode.org | Windows Greek                                        |
| ` 1254` | unicode.org | Windows Turkish                                      |
| ` 1255` | unicode.org | Windows Hebrew                                       |
| ` 1256` | unicode.org | Windows Arabic                                       |
| ` 1257` | unicode.org | Windows Baltic                                       |
| ` 1258` | unicode.org | Windows Vietnam                                      |
| ` 1361` |  Windows 7  | Korean (Johab)                                       |
| `10000` | unicode.org | MAC Roman                                            |
| `10001` |  Windows 7  | Japanese (Mac)                                       |
| `10002` |  Windows 7  | MAC Traditional Chinese (Big5)                       |
| `10003` |  Windows 7  | Korean (Mac)                                         |
| `10004` |  Windows 7  | Arabic (Mac)                                         |
| `10005` |  Windows 7  | Hebrew (Mac)                                         |
| `10006` | unicode.org | Greek (Mac)                                          |
| `10007` | unicode.org | Cyrillic (Mac)                                       |
| `10008` |  Windows 7  | MAC Simplified Chinese (GB 2312)                     |
| `10010` |  Windows 7  | Romanian (Mac)                                       |
| `10017` |  Windows 7  | Ukrainian (Mac)                                      |
| `10021` |  Windows 7  | Thai (Mac)                                           |
| `10029` | unicode.org | MAC Latin 2 (Central European)                       |
| `10079` | unicode.org | Icelandic (Mac)                                      |
| `10081` | unicode.org | Turkish (Mac)                                        |
| `10082` |  Windows 7  | Croatian (Mac)                                       |
| `12000` |    magic    | Unicode UTF-32, little endian byte order             |
| `12001` |    magic    | Unicode UTF-32, big endian byte order                |
| `20000` |  Windows 7  | CNS Taiwan (Chinese Traditional)                     |
| `20001` |  Windows 7  | TCA Taiwan                                           |
| `20002` |  Windows 7  | ETEN Taiwan (Chinese Traditional)                    |
| `20003` |  Windows 7  | IBM5550 Taiwan                                       |
| `20004` |  Windows 7  | TeleText Taiwan                                      |
| `20005` |  Windows 7  | Wang Taiwan                                          |
| `20105` |  Windows 7  | Western European IA5 (IRV International Alphabet 5)  |
| `20106` |  Windows 7  | IA5 German (7-bit)                                   |
| `20107` |  Windows 7  | IA5 Swedish (7-bit)                                  |
| `20108` |  Windows 7  | IA5 Norwegian (7-bit)                                |
| `20127` |    magic    | US-ASCII (7-bit)                                     |
| `20261` |  Windows 7  | T.61                                                 |
| `20269` |  Windows 7  | ISO 6937 Non-Spacing Accent                          |
| `20273` |  Windows 7  | IBM EBCDIC Germany                                   |
| `20277` |  Windows 7  | IBM EBCDIC Denmark-Norway                            |
| `20278` |  Windows 7  | IBM EBCDIC Finland-Sweden                            |
| `20280` |  Windows 7  | IBM EBCDIC Italy                                     |
| `20284` |  Windows 7  | IBM EBCDIC Latin America-Spain                       |
| `20285` |  Windows 7  | IBM EBCDIC United Kingdom                            |
| `20290` |  Windows 7  | IBM EBCDIC Japanese Katakana Extended                |
| `20297` |  Windows 7  | IBM EBCDIC France                                    |
| `20420` |  Windows 7  | IBM EBCDIC Arabic                                    |
| `20423` |  Windows 7  | IBM EBCDIC Greek                                     |
| `20424` |  Windows 7  | IBM EBCDIC Hebrew                                    |
| `20833` |  Windows 7  | IBM EBCDIC Korean Extended                           |
| `20838` |  Windows 7  | IBM EBCDIC Thai                                      |
| `20866` |  Windows 7  | Russian Cyrillic (KOI8-R)                            |
| `20871` |  Windows 7  | IBM EBCDIC Icelandic                                 |
| `20880` |  Windows 7  | IBM EBCDIC Cyrillic Russian                          |
| `20905` |  Windows 7  | IBM EBCDIC Turkish                                   |
| `20924` |  Windows 7  | IBM EBCDIC Latin 1/Open System (1047 + Euro symbol)  |
| `20932` |  Windows 7  | Japanese (JIS 0208-1990 and 0212-1990)               |
| `20936` |  Windows 7  | Simplified Chinese (GB2312-80)                       |
| `20949` |  Windows 7  | Korean Wansung                                       |
| `21025` |  Windows 7  | IBM EBCDIC Cyrillic Serbian-Bulgarian                |
| `21027` |     NLS     | Extended/Ext Alpha Lowercase                         |
| `21866` |  Windows 7  | Ukrainian Cyrillic (KOI8-U)                          |
| `28591` | unicode.org | ISO 8859-1 Latin 1 (Western European)                |
| `28592` | unicode.org | ISO 8859-2 Latin 2 (Central European)                |
| `28593` | unicode.org | ISO 8859-3 Latin 3                                   |
| `28594` | unicode.org | ISO 8859-4 Baltic                                    |
| `28595` | unicode.org | ISO 8859-5 Cyrillic                                  |
| `28596` | unicode.org | ISO 8859-6 Arabic                                    |
| `28597` | unicode.org | ISO 8859-7 Greek                                     |
| `28598` | unicode.org | ISO 8859-8 Hebrew (ISO-Visual)                       |
| `28599` | unicode.org | ISO 8859-9 Turkish                                   |
| `28600` | unicode.org | ISO 8859-10 Latin 6                                  |
| `28601` | unicode.org | ISO 8859-11 Latin (Thai)                             |
| `28603` | unicode.org | ISO 8859-13 Latin 7 (Estonian)                       |
| `28604` | unicode.org | ISO 8859-14 Latin 8 (Celtic)                         |
| `28605` | unicode.org | ISO 8859-15 Latin 9                                  |
| `28606` | unicode.org | ISO 8859-15 Latin 10                                 |
| `29001` |  Windows 7  | Europa 3                                             |
| `38598` |  Windows 7  | ISO 8859-8 Hebrew (ISO-Logical)                      |
| `47451` | unicode.org | Atari ST/TT                                          |
| `50220` |    magic    | ISO 2022 JIS Japanese with no halfwidth Katakana     |
| `50221` |    magic    | ISO 2022 JIS Japanese with halfwidth Katakana        |
| `50222` |    magic    | ISO 2022 Japanese JIS X 0201-1989 (1 byte Kana-SO/SI)|
| `50225` |    magic    | ISO 2022 Korean                                      |
| `50227` |    magic    | ISO 2022 Simplified Chinese                          |
| `51932` |  Windows 7  | EUC Japanese                                         |
| `51936` |  Windows 7  | EUC Simplified Chinese                               |
| `51949` |  Windows 7  | EUC Korean                                           |
| `52936` |  Windows 7  | HZ-GB2312 Simplified Chinese                         |
| `54936` |  Windows 7  | GB18030 Simplified Chinese (4 byte)                  |
| `57002` |  Windows 7  | ISCII Devanagari                                     |
| `57003` |  Windows 7  | ISCII Bengali                                        |
| `57004` |  Windows 7  | ISCII Tamil                                          |
| `57005` |  Windows 7  | ISCII Telugu                                         |
| `57006` |  Windows 7  | ISCII Assamese                                       |
| `57007` |  Windows 7  | ISCII Oriya                                          |
| `57008` |  Windows 7  | ISCII Kannada                                        |
| `57009` |  Windows 7  | ISCII Malayalam                                      |
| `57010` |  Windows 7  | ISCII Gujarati                                       |
| `57011` |  Windows 7  | ISCII Punjabi                                        |
| `65000` |    magic    | Unicode (UTF-7)                                      |
| `65001` |    magic    | Unicode (UTF-8)                                      |

`unicode.org` refers to the Unicode Consortium Public Mappings, a database of
various mappings between Unicode characters and respective character sets.  The
tables are processed by a few scripts in the build process.

`IBM` refers to the IBM coded character set database.  Even though IBM uses a
different numbering scheme from Windows, the IBM numbers are used when there is
no conflict.  The tables are manually generated from the symbol manifests.

`Windows 7` refers to direct inspection of Windows 7 machines using .NET class
`System.Text.Encoding`.  The enclosed `MakeEncoding.cs` C# program brute-forces
code pages. `MakeEncoding.cs` deviates from unicode.org in some cases. When they
map a given code to different characters, unicode.org value is used. When
unicode.org does not prescribe a value, `MakeEncoding.cs` value is used.

`NLS` refers to the National Language Support files supplied in various versions
of Windows.  In older versions of Windows (like Windows 98) these files followed
the name pattern `CP_#.NLS`, but newer versions use the name pattern `C_#.NLS`.

## Testing

`make test` will run the nodejs-based test.

To run the in-browser tests, run a local server and go to the `ctest` directory.
`make ctestserv` will start a python `SimpleHTTPServer` server on port 8000.

To update the browser artifacts, run `make ctest`.

## Sources

- [Unicode Consortium Public Mappings](http://www.unicode.org/Public/MAPPINGS/)
- [Windows Code Page Enumeration](http://msdn.microsoft.com/en-us/library/cc195051.aspx)
- [Windows Code Page Identifiers](http://msdn.microsoft.com/en-us/library/windows/desktop/dd317756.aspx)
- [IBM Coded Character Sets](https://www-01.ibm.com/software/globalization/ccsid/ccsid_registered.html)
- [ISO/IEC 2022 / ECMA-35](https://www.ecma-international.org/publications/files/ECMA-ST/Ecma-035.pdf)
- [International Register of Coded Character Sets To Be Used With Escape Sequences](https://www.itscj.ipsj.or.jp/itscj_english/iso-ir/ISO-IR.pdf)
- [Japanese Character Encoding for Internet Messages](https://tools.ietf.org/html/rfc1468)

## License

Please consult the attached LICENSE file for details.  All rights not explicitly
granted by the Apache 2.0 license are reserved by the Original Author.

## Badges

[![Sauce Test Status](https://saucelabs.com/browser-matrix/codepage.svg)](https://saucelabs.com/u/codepage)

[![Build Status](https://travis-ci.org/SheetJS/js-codepage.svg?branch=master)](https://travis-ci.org/SheetJS/js-codepage)

[![Coverage Status](http://img.shields.io/coveralls/SheetJS/js-codepage/master.svg)](https://coveralls.io/r/SheetJS/js-codepage?branch=master)

[![Analytics](https://ga-beacon.appspot.com/UA-36810333-1/SheetJS/js-codepage?pixel)](https://github.com/SheetJS/js-codepage)
