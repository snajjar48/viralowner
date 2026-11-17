# Viral playbooks

`viral-playbook.md` (skits) and `food-playbook.md` (food & drink) are added to the editor's instructions (clip matching, one-take editing, change requests,
effects and the start-from-scratch director). The skits one is written from studies of real viral skits.

To make the skits playbook again from a folder of videos:

```
modal run scripts/study-viral.py --folder "<folder of videos>" --out <dir>
```

For each video, the study does four things:

1. Cuts off the platform's end screen.
2. Measures cuts, word timings, pauses and audio hits.
3. Has Claude break the video down: hook, beats, comedic timing, captions, text, audio, pacing and ending. TikTok and Instagram logos and watermarks are ignored.
4. Writes one playbook from all the studies. `studies.json` and `summary.json` hold the per-video data and measurements.

## Food & drink playbook

`food-playbook.md` comes from studies of real viral food and drink videos, and is followed only when a video shows
food or drink. Make it again with:

```
modal run scripts/study-food.py --folder "<folder of videos>" --out <dir>
```

Its study also measures video quality (resolution, frame rate, bitrate), a motion graph every half second (to spot
slow motion and speed ramps) and the frames around every cut (to see transitions), and it breaks down how the food is
shown, close-ups and pours, the money shot, ASMR versus fast pacing, speed, text, transitions, effects and quality.

## Talking-head playbook

`talking-playbook.md` comes from studies of real viral talking-head ("yapping") videos and is followed whenever a
video is mainly someone talking to the camera. `creator-advice.md` collects the content-creation advice the speakers
gave (it isn't sent to the editor). Make them again with:

```
modal run scripts/study-talking.py --folder "<folder of videos>" --out <dir>
```

## Travel playbook

`travel-playbook.md` comes from studies of 143 real viral travel videos (resorts, cruises, theme parks, destinations,
pick-one / choose-your-vibe videos, tips and tours) and leads every video in the travel category. Its study looks
closely at action shots, view reveals, the multiple choice formats and the info that gets videos saved and booked.
Make it again with (the videos go up to a Modal volume first, `modal volume put viralowner-study-travel ...`):

```
modal run scripts/study-travel.py --folder "<folder of videos>" --out <dir>
```

## Categories

People pick a category when they start a video (`src/lib/categories.ts`, `CATEGORIES` in `worker/app.py`). The
category's playbook leads (it's the main one for that video and wins where another disagrees); the others still apply
where they fit. A category whose file isn't here yet still sets the vibe, and its playbook joins as soon as the file
is added and the worker is deployed. The admin dashboard's categories page shows which ones are ready.

| category | playbook |
| --- | --- |
| food & drink | `food-playbook.md` |
| skits | `viral-playbook.md` |
| talking head / yapping | `talking-playbook.md` |
| influencer / vlog | `influencer-playbook.md` (not written yet) |
| event recap | `event-playbook.md` (not written yet) |
| travel / destination / vacation | `travel-playbook.md` |

Each category also learns every day from the change requests, notes and feedback on its own videos (`src/lib/lessons.ts`);
those lessons go with that category's videos, after the lessons for every video.
