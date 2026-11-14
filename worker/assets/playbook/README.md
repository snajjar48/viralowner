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
