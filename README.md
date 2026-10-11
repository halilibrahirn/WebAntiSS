# WebAntiSS – Website Anti-Screenshot Image Protection

WebAntiSS is a small JavaScript library that helps protect images on websites from being captured by screenshots.

It replaces each <img> with a <canvas>. The canvas only draws small, random parts of the image at a time. Because the full image is never shown all at once, a screenshot can only capture a small piece—not the whole picture.

# Features

· Works automatically on all images
· No dependencies
· Uses IntersectionObserver and requestIdleCallback for smooth performance
· Lightweight and easy to drop in

# Usage

Using AntiSS is very simple. Just include the script in your HTML:

```html
<script src="protect.js"></script>
```

That’s it. It will automatically find and protect all images on the page.

To skip a specific image, add data-asp="off":

```html
<img src="photo.jpg" data-asp="off">
```

You can also manually refresh if new images are added later:

```js
window.AntiSS.refresh();
```

# Note

This is not perfect security. It only makes casual screenshot capture harder.
