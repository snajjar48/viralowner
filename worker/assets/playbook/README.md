# Viral playbook

`viral-playbook.md` is added to the editor's instructions (clip matching, one-take editing, change requests,
effects and the start-from-scratch director). It's written from studies of real viral skits.

To make it again from a folder of videos:

```
modal run scripts/study-viral.py --folder "<folder of videos>" --out <dir>
```

For each video, the study does four things:

1. Cuts off the platform's end screen.
2. Measures cuts, word timings, pauses and audio hits.
3. Has Claude break the video down: hook, beats, comedic timing, captions, text, audio, pacing and ending. TikTok and Instagram logos and watermarks are ignored.
4. Writes one playbook from all the studies. `studies.json` and `summary.json` hold the per-video data and measurements.
