## Summary

Add Umami analytics tracking to the QCE landing page (qce.sdjz.wiki).

## Changes

- Added Umami analytics script to `public/index.html`
- Script loads asynchronously with `defer` attribute to avoid blocking page render
- Site ID: `3ffbbfd9a5ac`
- Analytics endpoint: `https://stats.axtn.net/api/script.js`

## Technical Details

The script is placed in the `<head>` section following Umami's recommended integration pattern:
- Uses `defer` attribute for non-blocking load
- Minimal performance impact on page load
- Privacy-friendly analytics (Umami is GDPR compliant)

## Testing

- [x] Verified script placement in HTML head
- [x] Confirmed proper attribute formatting
