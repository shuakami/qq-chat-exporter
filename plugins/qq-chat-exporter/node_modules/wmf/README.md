# js-wmf

Processor for Windows MetaFile (WMF) files in JS (for the browser and nodejs).


## Installation

With [npm](https://www.npmjs.org/package/wmf):

```bash
$ npm install wmf
```

In the browser:

```html
<script src="wmf.js"></script>
```

The browser exposes a variable `WMF`.


## Usage

The `data` argument is expected to be an `ArrayBuffer`, `Uint8Array` or `Buffer`

- `WMF.image_size(data)` extracts the image offset and extents, returns an Array
  `[width, height]` where both metrics are measured in pixels.

- `WMF.draw_canvas(data, canvas)` parses the WMF and draws to a `Canvas`.

### Notes

- The library assumes the global `ImageData` is available.  For nodejs-powered
  canvas implementations, a shim must be exposed as a global. Using the `canvas`
  npm package:

```js
const { createImageData } = require("canvas");
global.ImageData = createImageData;
```

- `OffscreenCanvas` in Chrome and some other Canvas implementations require
  the dimensions in the constructor:

```js
const size = WMF.image_size(data);
const canvas = new OffscreenCanvas(size[0], size[1]);
```


## Examples

<details>
  <summary><b>Browser Fetch into canvas</b> (click to show)</summary>

```js
// assume `canvas` is a DOM element
(async() => {
  const res = await fetch("url/for/image.wmf");
  const ab = await res.arrayBuffer();
  WMF.draw_canvas(ab, document.getElementById("canvas"));
})();
```

</details>

<details>
  <summary><b>NodeJS (using `canvas` npm module)</b> (click to show)</summary>

```js
const { createCanvas, createImageData } = require("canvas");
global.ImageData = createImageData;

const size = WMF.image_size(data);
const canvas = createCanvas(size[0], size[1]);
WMF.draw_canvas(data, canvas);
```

</details>


## License

Please consult the attached LICENSE file for details.  All rights not explicitly
granted by the Apache 2.0 License are reserved by the Original Author.


## References

 - `MS-WMF`: Windows Metafile Format

