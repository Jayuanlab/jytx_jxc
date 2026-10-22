import pathlib,json,sys
root=pathlib.Path.cwd()
extra=json.load(sys.stdin)
p=root/"web/knowledge-review.js";s=p.read_text(encoding="utf-8");p.write_text(s+extra,encoding="utf-8")
p=root/"server/src/assistant-feedback.js";s=p.read_text(encoding="utf-8").replace("targetTitle:target?.title||'新增问答',","targetTitle:target?.title||'新增问答',targetAnswer:target?.answer||'',targetAnswerMandarin:target?.answerMandarin||'',");p.write_text(s,encoding="utf-8")
p=root/"scripts/test-assistant-adjacent-answer-ui.cjs";s=p.read_text(encoding="utf-8").replace("assert.ok(bounds.controlsTop>bounds.answerTop);","assert.ok(bounds.controlsTop<bounds.answerTop);");p.write_text(s,encoding="utf-8")
print("Review queue wired")
