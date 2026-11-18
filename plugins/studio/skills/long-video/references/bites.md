# Sound bites in a long video

in a video about people, 2 to 4 scenes are the person's own words instead of the narrator's, the
way a documentary cuts to an interview. Such a scene has no narration of its own:
`{"id": "jobs-said", "section": "...", "say": "(bite)", "fallback_say": "<one narrated line that makes the same
point>", "bite": {"query": "Steve Jobs Stanford commencement speech 2005", "find": ["fired", "Apple", "best"],
"name": "Steve Jobs", "role": "Stanford, 2005"}, "shots": [{"kind": "clip", "query": "<footage for the fallback>"}]}`.
`query` finds the interview or talk on YouTube; `find` is 2 to 4 words they must say in the few seconds wanted.
Only words the person is on record saying (research.md has the source), never a bite for a claim you need them to
have made. The line before a bite sets it up; the line after picks up from it.
