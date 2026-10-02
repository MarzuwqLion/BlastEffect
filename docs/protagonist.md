# Protagonist reference: Imani Cruz

Written from the attached reference image before any code. The in-game model
(`src/character/`) is built from this description, and the screenshots in
`docs/screenshots/` are checked against it.

## Overall read

- Full-body, front three-quarter standing pose on a white background.
- Young adult woman, athletic and solidly built: broad shoulders, strong
  thighs, defined waist. Roughly 1.72 m tall. The armor adds bulk at the
  shoulders, thighs, knees and shins, so her silhouette is wider at the
  shoulders and the lower legs than at the waist.
- Stance: feet a bit wider than shoulder width, weight settled, slightly
  turned toward her left. Calm and confident, not posing for a fight.
- Silhouette from any distance: a big round mass of curls on top, a
  bright yellow-and-blue armored body, a long rifle barrel sticking up
  past her left shoulder, and a stubby yellow SMG held across her hips.

## Head and face

- Skin: warm medium brown with golden undertones, smooth, with soft
  highlights on the forehead, nose and cheekbones. A few faint freckles
  across the nose and cheeks.
- Face shape: oval with defined cheekbones and a narrow, gently rounded chin.
- Eyes: light amber-brown, almond-shaped, slightly heavy-lidded. Dark,
  defined lashes. The gaze is level, direct, a little amused.
- Brows: dark brown, full, softly arched, groomed.
- Nose: straight bridge, softly rounded tip, medium width.
- Lips: full, closed, a muted rose-mauve tone. A faint closed-mouth
  half-smile, more on her right side. Reads as dry humour.
- Head is tilted slightly to her right (viewer's left).
- Ears are mostly hidden by hair. Small gold stud earrings are plausible
  but not clearly visible, so the model leaves them out.

## Hair

- A large, round afro of tight spiral curls, roughly 1.6-1.8x the width
  of her head and rising well above the crown. It frames the face down
  to about the jaw on both sides; the forehead is partly exposed with a
  few curls falling onto it.
- Colour: golden-brown / honey. Darker chestnut brown at the roots and in
  the shadowed interior, lighter honey-blonde at the tips and on the outer
  surface where light hits. Individual ringlets are distinct, small
  (about 1-2 cm across) and springy, so the surface is bumpy, not smooth.
- Model notes: build it as a volume of many small curl clusters with
  real depth (a dark inner shell and lighter outer curls), never a smooth
  sphere. Colour ramp: root `#4a2c16`, mid `#8a5a2b`, tip `#c9934a`,
  highlight `#e0b06a`.

## Armor and suit

Everything is one colour scheme: **blue-and-yellow digital camo**. The
pattern is pixelated (blocky, square-edged blotches) rather than organic.

- Base bodysuit: royal / cobalt blue (`#1f4fd6`, darker folds `#14348f`)
  with yellow (`#f2c418`) pixel blotches and a few lighter blue patches.
- Armor plates: mostly yellow (`#f2c418`, shaded `#c99a10`) with blue
  pixel blotches over them, i.e. the inverse of the suit.
- Edges: thin dark seams and black trim (`#141414`) where plates meet,
  plus small panel lines.

Pieces, top to bottom:

- High mock-neck collar, blue camo, covering most of the neck.
- Chest: segmented plate carrier. Two angled upper chest plates and a
  stack of horizontal abdominal plates, all yellow-dominant. Rounded
  edges, slightly chunky, mecha-like.
- Black nylon harness straps over both shoulders and across the chest
  (the rifle sling and carrier straps).
- Shoulders: layered, rounded pauldrons, two or three overlapping
  segments on each side, yellow-dominant.
- Upper arms: blue camo sleeves with a yellow plate on the outer bicep.
- Forearms: chunky yellow vambraces with blue camo.
- Hands: dark navy-black tactical gloves with armored knuckle plates.
- Waist: black utility belt with small pouches; blue camo hips.
- Thighs: large yellow tasset plates on the outside of each thigh with a
  boxy pouch (right thigh) and a holster-like block. Blue camo underneath.
- Knees: big rounded yellow knee pads with blue blotches.
- Shins: segmented yellow shin guards with straps, wrapping the calf.
- Boots: blue-and-yellow camo combat boots with chunky black treaded
  soles and armored ankle cuffs.

## Weapons

- **SMG (held)**: compact, boxy, bullpup-like, bright yellow body with a
  black top rail, black pistol grip and foregrip, a short black barrel /
  muzzle block and an angular magazine well. A small **red LED ammo
  readout** on the left side shows a two-digit count ("33" in the image).
  She holds it diagonally across her hips, right hand on the grip, left
  hand under the front, muzzle angled down and to her left.
- **Rifle (slung)**: a long rifle on her back, yellow receiver with black
  parts, a black scope, and a long thin black barrel with a muzzle brake.
  It hangs diagonally: stock low behind her left hip, barrel rising past
  her left shoulder well above her head.

## Personality cues for animation

- Relaxed weight shifts, small head tilts, unhurried. Breathing visible
  in the shoulders.
- Not a power-fantasy pose: efficient, economical movement. When idle,
  the SMG rests low across the body exactly as in the reference.
- In dialogue close-ups the face should carry the same level, slightly
  wry look: neutral mouth with a slight one-sided lift, steady eyes,
  occasional blinks.

## Camera priorities

The gameplay camera sees her from behind and over the right shoulder, so
detail goes to: the hair volume and colour ramp, the back of the armor
(shoulder pauldrons, harness straps, the slung rifle), the camo, and the
SMG with its readout. The face matters in dialogue close-ups only.
