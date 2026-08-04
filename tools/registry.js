const tools = {};
const order = [];

function registerTool(tool) {
  if (!tools[tool.name]) order.push(tool.name);
  tools[tool.name] = tool;
}

function getTool(name) { return tools[name] || null; }

function getToolsSchema() {
  return order.map((name) => ({
    type: "function",
    function: {
      name,
      description: tools[name].description,
      parameters: tools[name].parameters,
    },
  }));
}

function listTools() { return order.slice(); }

if (typeof module !== "undefined") {
  module.exports = { registerTool, getTool, getToolsSchema, listTools };
}
