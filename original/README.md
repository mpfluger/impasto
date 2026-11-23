# Saint-Rémy: a walk inside a painting

A contemplative walking simulator set inside a living, Van Gogh-style oil painting.
Wander from a hilltop cypress down through wheat, lavender and ploughed fields to a
lamplit village by a lake, beneath a sky of turning vortices and haloed stars.

## Run it

```
python serve.py
```

Then open http://localhost:5174 in Chrome, Edge or Firefox. Any static file server works.
The page loads Three.js from a CDN, so the first load needs an internet connection.
Add `?instant` to the URL to skip the title card.

## Controls

| Key | |
|---|---|
| WASD / arrows | wander |
| mouse | look (click to capture; Esc releases) |
| Shift | hurry |
| Space | float |
| T (hold) | hasten time |
| 1 2 3 4 | jump to night / dawn / day / dusk |
| P | lift the paint (see the raw 3D world) |
| M | sound on/off |
| H | hide words |
| F | fullscreen |

Stand still for a while, especially while looking up, and the painting begins to dream:
the swirls quicken, strokes lengthen, the mountains breathe, and a line from Vincent's
letters surfaces.

## How it is painted

The look comes from the pipeline, not from textures. There are no image assets at all.

1. **Scene pass (2 render targets).** Every material writes its colour plus a *brush field*:
   the screen-space direction a stroke should run at that pixel, and two stroke seeds
   anchored to the world surface. Strokes follow contours on hills, furrows in fields, roads,
   spirals on cypresses and vortices in the sky. Seeds use distance-blended octaves, so strokes
   keep a constant size on screen and never swim when you move.
2. **Paint pass.** A line-integral convolution drags colour along the brush field
   (about 37 samples per pixel). Seeds become per-stroke value and warm/cool jitter, and strokes
   stop at object boundaries.
3. **Finish.** The stroke seeds become a height map for impasto relief with a little
   specular sheen. Dark contour lines follow depth edges. The pass then adds bloom, a grade,
   canvas weave and grain. The opening "reveal" paints over a primed canvas and its blue
   underdrawing.

Four moods blend with the sun's height: *The Starry Night*, a rose dawn,
*Wheat Field with Cypresses* and *The Sower*. The soundscape (chords, twinkles, wind,
crickets, birds, footsteps, rustling wheat) is synthesised live with WebAudio.

Resolution adapts automatically to keep the frame rate smooth.

## Files

- `src/world.js`: terrain, field patchwork, roads, lake, village, vegetation (seeded)
- `src/glsl.js`: shared shader code: noise, stroke seeds, flow projection, lighting, sky
- `src/objects.js`: meshes and materials
- `src/post.js`: paint, bloom and composite passes
- `src/palette.js`: time of day, moods, sky vortices and stars
- `src/player.js`, `src/audio.js`, `src/main.js`
