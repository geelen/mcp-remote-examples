// @ts-nocheck

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import "./index.css";

// Set up the MCP client and Websocket transport
const client = new Client(
  {
    name: "mcp-typescript test client",
    version: "0.1.0",
  },
  {
    capabilities: {
      sampling: {},
    },
  }
);

const currentUrl = new URL(window.location.href);
const sseUrl = currentUrl.origin + "/mcp";
console.log(sseUrl);
const clientTransport = new SSEClientTransport(new URL(sseUrl));
let isConnected = false;

// The rest of the code is mostly AI generated frontend nonsense

// DOM Elements
const mcpUrl = document.getElementById("mcp-url");
const statusIndicator = document.getElementById("status-indicator");
const connectionStatus = document.getElementById("connection-status");
const connectBtn = document.getElementById("connect-btn");
const calculateBasicBtn = document.getElementById("calculate-basic");
const calculateAdvBtn = document.getElementById("calculate-adv");
const discoverBtn = document.getElementById("discover-btn");
const basicResult = document.getElementById("basic-result");
const advResult = document.getElementById("adv-result");
const toolsResult = document.getElementById("tools-result");
const wsLog = document.getElementById("ws-log");

// Set the MCP URL
mcpUrl.value = sseUrl;

// Event listeners
connectBtn.addEventListener("click", connect);
calculateBasicBtn.addEventListener("click", calculateBasic);
calculateAdvBtn.addEventListener("click", calculateAdvanced);
discoverBtn.addEventListener("click", discoverTools);
document
  .getElementById("adv-operation")
  .addEventListener("change", toggleExponentField);

// Initialize
toggleExponentField();

// Toggle exponent field visibility based on operation
function toggleExponentField() {
  const operation = document.getElementById("adv-operation").value;
  const exponentGroup = document.getElementById("exponent-group");

  if (operation === "power") {
    exponentGroup.style.display = "block";
    document.querySelector('label[for="exponent"]').textContent = "Exponent:";
  } else {
    exponentGroup.style.display = "none";
  }
}

// Connect to the MCP server
async function connect() {
  try {
    // Update UI
    statusIndicator.className = "status-indicator disconnected";
    connectionStatus.textContent = "Connecting...";

    window.ct = clientTransport;
    console.log(clientTransport);

    await client.connect(clientTransport);
    isConnected = true;
    logMessage("Connected to server", "info");

    connectionStatus.textContent = "Connected";
    statusIndicator.className = "status-indicator connected";

    // Enable buttons
    calculateBasicBtn.disabled = false;
    calculateAdvBtn.disabled = false;
    discoverBtn.disabled = false;
    connectBtn.disabled = true;
  } catch (error) {
    logMessage("Error connecting: " + error.message, "error");
    statusIndicator.className = "status-indicator disconnected";
    connectionStatus.textContent = "Connection Failed";
  }
}

// Discover available tools
async function discoverTools() {
  if (!isConnected) {
    toolsResult.textContent = "Not connected";
    return;
  }

  toolsResult.textContent = "Discovering tools...";

  try {
    const tools = await client.listTools();
    toolsResult.textContent = JSON.stringify(tools, null, 2);
    logMessage("Tools discovered", "info");
  } catch (error) {
    toolsResult.textContent = "Error: " + error.message;
    logMessage("Error: " + error.message, "error");
  }
}

// Calculate basic math operations
async function calculateBasic() {
  if (!isConnected) {
    basicResult.textContent = "Not connected";
    basicResult.classList.add("error");
    return;
  }

  const operation = document.getElementById("operation").value;
  const num1 = parseFloat(document.getElementById("num1").value);
  const num2 = parseFloat(document.getElementById("num2").value);

  if (isNaN(num1) || isNaN(num2)) {
    basicResult.textContent = "Please enter valid numbers";
    basicResult.classList.add("error");
    return;
  }

  basicResult.textContent = "Calculating...";
  basicResult.classList.remove("error");

  try {
    let { isError, content } = await client.callTool({
      name: operation,
      arguments: {
        a: num1,
        b: num2,
      },
    });
    if (isError) {
      basicResult.textContent = "Error: " + content[0].text;
      basicResult.classList.add("error");
      logMessage("Error: " + content[0].text, "error");
    } else {
      basicResult.textContent = content[0].text;
      basicResult.classList.remove("error");
      logMessage("Result: " + content[0].text, "info");
    }
  } catch (error) {
    basicResult.textContent = "Error: " + error.message;
    basicResult.classList.add("error");
    logMessage("Error: " + error.message, "error");
  }
}

// Calculate advanced math operations
async function calculateAdvanced() {
  if (!isConnected) {
    advResult.textContent = "Not connected";
    advResult.classList.add("error");
    return;
  }

  const operation = document.getElementById("adv-operation").value;
  const value = parseFloat(document.getElementById("value").value);
  const exponent = parseFloat(document.getElementById("exponent").value);

  if (isNaN(value) || (operation === "power" && isNaN(exponent))) {
    advResult.textContent = "Please enter valid numbers";
    advResult.classList.add("error");
    return;
  }

  advResult.textContent = "Calculating...";
  advResult.classList.remove("error");

  let params = {};

  if (operation === "power") {
    params = {
      base: value,
      exponent: exponent,
    };
  } else if (operation === "sqrt") {
    params = {
      value: value,
    };
  } else if (
    operation === "sin" ||
    operation === "cos" ||
    operation === "tan"
  ) {
    params = {
      angle: value,
    };
  } else if (operation === "log") {
    params = {
      value: value,
    };
  }

  try {
    let { isError, content } = await client.callTool({
      name: operation,
      arguments: params,
    });
    if (isError) {
      advResult.textContent = "Error: " + content[0].text;
      advResult.classList.add("error");
      logMessage("Error: " + content[0].text, "error");
    } else {
      advResult.textContent = content[0].text;
      advResult.classList.remove("error");
      logMessage("Result: " + content[0].text, "info");
    }
  } catch (error) {
    advResult.textContent = "Error: " + error.message;
    advResult.classList.add("error");
    logMessage("Error: " + error.message, "error");
  }
}

// Log a message to the WebSocket log
function logMessage(message, type) {
  const logEntry = document.createElement("div");
  logEntry.className = "log-entry log-" + type;
  logEntry.textContent = "[" + new Date().toLocaleTimeString() + "] " + message;

  wsLog.appendChild(logEntry);
  wsLog.scrollTop = wsLog.scrollHeight;

  // Limit log size
  while (wsLog.children.length > 100) {
    wsLog.removeChild(wsLog.firstChild);
  }
}
