# Sentient Orbs

A 3D vivarium of glowing orbs: instanced agents forage between a nest and food
sources inside a volumetric-fog cube, depositing pheromone trails. Rendered with
Three.js post-processing (volumetric fog → depth of field → bloom).

Open the debug panel with the **⚙** button (top-left) or the **`` ` ``** key.

## Depth of Field

The DoF pass (`dof.ts`) is a fork of Three's BokehPass with an intuitive
"sharp zone + gradient" blur curve instead of raw optical `aperture`/`maxblur`.
The panel exposes four controls:

| Control | Meaning |
|---|---|
| **Focus** | Focal-plane depth, in world units (view-space distance from camera). |
| **Focus Width** | Half-width of the **fully-sharp band** around the focal plane. |
| **Falloff** | Distance over which blur **ramps** sharp → full (the gradient). |
| **Blur Strength** | The blur ceiling (max circle-of-confusion). |

A 3-state switch toggles **OFF / ON / NEST**. In **NEST** mode the focal plane
tracks the blue nest automatically (Focus is driven live; the slider follows).

**The depth model.** A pixel is fully sharp while its depth is within
`Focus ± Focus Width`. Past that it smoothsteps to full blur over the next
`Falloff` units, then clamps at `Blur Strength`:

```
sharp out to depth   = Focus + Focus Width
fully blurred by      = Focus + Focus Width + Falloff
```

Rule of thumb: **Focus Width** sets *how much* stays crisp; **Falloff** sets
*how soft* the edge is (small = hard cliff, large = dreamy ramp); **Blur
Strength** sets how strong the out-of-focus blur reads.

### Settings → effect

All rows hold **Focus = 40** (the shipped default). Scene depth spans roughly
40–90 world units, so these land the back of the cube in blur while the
front/mid stays sharp.

| Preset | Focus Width | Falloff | Blur Strength | Effect |
|---|---|---|---|---|
| **Shipped default** | 20 | 5 | 0.003 | Wide sharp zone, gentle soft edge. |
| Hard slab | 20 | 0.5 | 0.003 | Near-binary: sharp, then a sudden snap to faint blur. |
| Minimal soften | 20 | 15 | 0.003 | Same sharp zone as default, softer edge to compare Falloff. |
| Gentle | 14 | 22 | 0.005 | Sharp core, smooth readable falloff. |
| Cinematic | 10 | 32 | 0.006 | Tighter subject, long dreamy ramp. |
| Dreamy | 6 | 45 | 0.008 | Small sharp spot, lots of soft blur. |

Notes:
- **Blur Strength matters with Falloff** — a long, gentle ramp at a tiny Blur
  Strength is imperceptible; raise the ceiling so the gradient actually reads.
- A longer Falloff with a low ceiling is the "soft" look; a short Falloff with a
  higher ceiling is the "snappy" look.
- DoF runs **before** bloom so an in-focus subject's bright halo isn't smeared —
  keep that ordering if you touch the pass chain.
