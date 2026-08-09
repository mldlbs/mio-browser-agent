registerTool({
  name: "form_fill",
  description: "Fill a form in one call. fields maps semantic keys (username, password, email, city, agree...) to values: a string fills a text field, {select: \"option text\"} selects an option in a dropdown, true/false checks/unchecks a checkbox. Keys are matched to visible fields by label/placeholder (exact first, synonyms like 用户名→username second). submit=true also clicks the form's submit button (login/注册/提交/sign in). Returns per-field status; missing keys are reported as FIELD_NOT_FOUND and already-filled fields are kept.",
  parameters: {
    type: "object",
    properties: {
      fields: {
        type: "object",
        description: "Map of field key → value. Text: string. Select: {select: \"option text\"}. Checkbox: true/false.",
      },
      submit: { type: "boolean", default: false, description: "Also click the form's submit button after filling" },
    },
    required: ["fields"],
  },
  async execute(args, ctx) {
    if (!args.fields || typeof args.fields !== "object" || Object.keys(args.fields).length === 0) {
      return { ok: false, error: "form_fill requires a non-empty fields object" };
    }
    return await ctx.bridge.executeAction({
      name: "form_fill",
      target: null,
      args: { fields: args.fields, submit: !!args.submit },
    });
  },
});
