# Saint-Rémy: a walk inside a painting

A contemplative walking simulator set inside a living, Van Gogh-style oil painting.
Wander from a hilltop cypress down through meadows, lavender and ploughed fields to a
lamplit village by a lake, beneath a sky of turning vortices and haloed stars.

## Run it

```
python serve.py
```

Then open http://localhost:5173 in Chrome, Edge or Firefox. Any static file server works.
The page loads Three.js from a CDN, so the first load needs an internet connection.
Add `?instant` to the URL to skip the title card.

## Controls

| Key | |
|---|---|
| WASD / arrows | wander |
| mouse | look (held while you are inside the painting) |
| Esc | leave fullscreen; in a window, back to the title |
| Shift | hurry |
| Space | float |
| T (hold) | hasten time |
| 1 2 3 4 | jump to night / dawn / day / dusk |
| P | lift the paint (see the raw 3D world) |
| M | sound on/off |
| H | hide words |
| F | fullscreen |
| X | back to the title |
| ? | show every key |

Stand still (looking around slowly is fine) and after about 12 seconds the painting begins to
dream: the swirls quicken, strokes lengthen, colours drift, the far mountains heave like slow
swells, and around half a minute in a line from Vincent's letters surfaces. Gazing up at the
sky hurries it along.

## How it is painted

The look comes from the pipeline, not from textures. There are no image assets at all.

1. **Scene pass (3 render targets).** Every material writes its colour, a *brush field* (the
   screen-space direction a stroke should run at that pixel: along contours on hills, furrows
   in fields, roads, spirals on cypresses, vortices in the sky), and the stroke the pixel belongs
   to. Stroke centres are scattered on a world-space grid whose size follows distance, so
   strokes stay attached to the surface they were painted on and keep a steady size on screen.
2. **Drag pass.** A line-integral convolution drags colour along the brush field.
3. **Stroke pass.** Each pixel gathers the strokes whose centres lie nearby along the flow.
   Each stroke is laid along the flow at its own centre, filled with the colour found there:
   set down bluntly, narrowing and running dry where the brush lifted, with a rounded crown,
   bristle furrows and a ridge of paint at its end. The two uppermost strokes are kept, one laid
   over the other. Each stroke is mixed separately: a pale tint with lead white, the mid tone or
   a deeper shade, nudged warm or cool, with streaks of unmixed paint. Flowers are single domed blobs.
4. **Finish.** The stroke heights are lit like impasto by the scene's own light (the moon by
   night, the sun by day) as seen from where you stand, so ridges catch the light and shadows swing
   as you turn; each stroke casts a short shadow onto the paint beneath it. Dark contour lines
   follow depth edges (umber round the cypress), the mountain ridge keeps a dark line against the
   sky, and the canvas weave shows where paint is thin. Then bloom, a grade, a slow ripple and
   colour drift, and grain.

The sky follows The Starry Night: its eleven stars and crescent moon where the painting has them,
courses of strokes round each vortex, and Vincent's dark ultramarine dashes between the light
strokes. The sky is painted live: strokes stay where they were laid, and every so often each is
repainted in place, a new stroke dragged in over it in the newer colours of the turning swirl.
The hills roll in rounded blue forms; the cypress rises in S-curving flame tongues with umber
creases; the trees round the village are painted in curls.

Four moods blend with the sun's height: *The Starry Night*, a rose dawn,
*Wheat Field with Cypresses* and *The Sower*. The soundscape (chords, twinkles, wind,
crickets, birds, footsteps) is synthesised live with WebAudio.

Resolution adapts automatically to keep the frame rate smooth.

## Files

- `src/world.js`: terrain, field patchwork, roads, lake, village, vegetation (seeded)
- `src/glsl.js`: shared shader code: noise, stroke seeds, flow projection, lighting, sky
- `src/objects.js`: meshes and materials
- `src/post.js`: paint, bloom and composite passes
- `src/palette.js`: time of day, moods, sky vortices and stars
- `src/player.js`, `src/audio.js`, `src/main.js`
