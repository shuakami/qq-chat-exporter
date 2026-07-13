export function kindOf(html) {
  if (
    hasClass(html, 'sticker-wrap') ||
    hasClass(html, 'market-face') ||
    hasClass(html, 'face-emoji')
  ) return 'sticker';
  if (hasClass(html, 'image-content')) return 'img';
  if (hasClass(html, 'audio-wrapper') || hasClass(html, 'message-audio')) return 'voice';
  if (hasClass(html, 'message-video')) return 'video';
  if (hasClass(html, 'message-file')) return 'file';
  if (hasClass(html, 'reply-content')) return 'reply';
  if (hasClassPrefix(html, 'forward-card')) return 'forward';
  if (hasClassPrefix(html, 'location-')) return 'location';
  if (hasClass(html, 'json-card')) return 'card';
  return 'text';
}

function classValues(html) {
  return Array.from(html.matchAll(/\bclass=(["'])(.*?)\1/gs), (match) => match[2] ?? '');
}

function hasClass(html, expected) {
  return classValues(html).some((value) => value.split(/\s+/).includes(expected));
}

function hasClassPrefix(html, prefix) {
  return classValues(html).some((value) =>
    value.split(/\s+/).some((className) => className.startsWith(prefix)),
  );
}
