(function () {
  const results = [];
  function check(cond, name) {
    results.push(cond);
    const div = document.createElement("div");
    div.textContent = (cond ? "PASS: " : "FAIL: ") + name;
    div.style.color = cond ? "#a6e3a1" : "#f38ba8";
    document.getElementById("results").appendChild(div);
  }

  const snap = captureSnapshot();
  check(snap.elements.length >= 4, "snapshot captures >= 4 interactive elements");
  const sbtn = snap.elements.find((e) => e.name.includes("幽灵按钮"));
  check(!!sbtn && sbtn.shadowPath.length >= 1, "snapshot finds button inside open shadow root");
  const sinput = snap.elements.find((e) => e.placeholder === "shadow输入框");
  check(!!sinput && sinput.shadowPath.length >= 1, "snapshot finds input inside open shadow root");
  const sel = locateElement(sbtn);
  check(!!sel && sel.id === "shadow-btn", "locator round-trips shadow element via cssPath");
  window.__shadowClicks = 0;
  const sclick = executeAction({ name: "click", target: sbtn, args: {} });
  check(sclick.ok && window.__shadowClicks === 1, "executor clicks button inside shadow root");
  const btn = snap.elements.find((e) => e.role === "button" && e.name.includes("登录"));
  check(!!btn, "snapshot finds login button by role+name");
  const inp = snap.elements.find((e) => e.role === "textbox" && e.placeholder);
  check(!!inp, "snapshot finds textbox with placeholder");
  const ed = snap.elements.find((e) => e.role === "textbox" && e.tag === "div");
  check(!!ed, "snapshot finds contenteditable as textbox");

  const el = locateElement(btn);
  check(!!el && el.id === "btn-login", "locator round-trips snapshot element");

  const typeRes = executeAction({ name: "type", target: inp, args: { text: "hello", clear: true } });
  check(typeRes.ok && document.getElementById("input-search").value === "hello", "executor types into input");

  window.__clicked = 0;
  const clickRes = executeAction({ name: "click", target: btn, args: {} });
  check(clickRes.ok && window.__clicked === 1, "executor clicks button");

  const edRes = executeAction({ name: "type", target: ed, args: { text: "x", clear: true } });
  check(edRes.ok && document.getElementById("box-editor").textContent === "x", "executor types into contenteditable");

  // form_fill: one call fills text/select/checkbox and can submit
  const ffFields = { username: "alice", password: "s3cret", city: { select: "上海" }, agree: true };
  const ffRes = executeAction({ name: "form_fill", target: null, args: { fields: ffFields, submit: false } });
  const ffUser = document.getElementById("ff-username");
  const ffPass = document.getElementById("ff-password");
  const ffCity = document.getElementById("ff-city");
  const ffAgree = document.getElementById("ff-agree");
  check(ffRes.ok, "form_fill returns ok", JSON.stringify(ffRes));
  check(ffUser.value === "alice", "form_fill fills username", ffUser.value);
  check(ffPass.value === "s3cret", "form_fill fills password", ffPass.value);
  check(ffCity.selectedIndex === 1 && ffCity.options[1].text === "上海", "form_fill selects city by option text", ffCity.value);
  check(ffAgree.checked === true, "form_fill checks checkbox", String(ffAgree.checked));
  // missing field key → FIELD_NOT_FOUND, already-filled retained
  const ffMiss = executeAction({ name: "form_fill", target: null, args: { fields: { nosuchkey: "x", username: "bob" } } });
  check(!ffMiss.ok && ffMiss.errorCode === "FIELD_NOT_FOUND", "form_fill reports FIELD_NOT_FOUND for unknown key", JSON.stringify(ffMiss));
  check(ffUser.value === "bob", "form_fill keeps successfully-filled fields on partial failure", ffUser.value);

  const fail = results.filter((c) => !c).length;
  const final = document.createElement("div");
  final.textContent = fail === 0 ? "=== ALL PASS ===" : fail + " FAILURE(S)";
  document.getElementById("results").appendChild(final);
  if (fail === 0) console.log("=== ALL PASS ===");
})();
