-- FreeDictate — one-button free dictation for Mac. MIT License, (c) Owen Monagan.
-- Local Whisper dictation: configurable talk key (tap or hold), transcribes via whisper-server, pastes.
-- HUD: transparent hs.webview loading app/hud/hud.html (falls back to an hs.canvas pill).
local M = {}

local SERVER = "http://127.0.0.1:8178/inference"
local SERVER_ROOT = "http://127.0.0.1:8178/"
local MODEL = os.getenv("HOME") .. "/.local/share/whisper/ggml-large-v3-turbo-q5_0.bin"
local WAV = (os.getenv("TMPDIR") or "/tmp/"):gsub("/?$", "/") .. "freedictate.wav"
local MIC_TEST_WAV = WAV:gsub("%.wav$", "-mictest.wav")
local LABEL = "dev.freedictate.whisper-server"
local OLD_LABEL = "com.owen.whisper-server" -- pre-rename installs

-- Homebrew lives in /opt/homebrew (Apple Silicon) or /usr/local (Intel); detect at runtime.
local function findBin(name, extra)
  for _, dir in ipairs({"/opt/homebrew/bin", "/usr/local/bin", extra}) do
    if dir and hs.fs.attributes(dir .. "/" .. name) then return dir .. "/" .. name end
  end
  return nil
end
local FFMPEG = findBin("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
local CURL = findBin("curl", "/usr/bin") or "/usr/bin/curl"
local WHISPER_CLI = findBin("whisper-cli") or "/opt/homebrew/bin/whisper-cli"

-- Settings: write freedictate.*, fall back to legacy dictate.* keys.
local function getSetting(k)
  local v = hs.settings.get("freedictate." .. k)
  if v == nil then v = hs.settings.get("dictate." .. k) end
  return v
end
local function setSetting(k, v) hs.settings.set("freedictate." .. k, v) end

-- Resolve app/ from this file's real location (~/.hammerspoon/dictate.lua is a symlink).
local function appDir()
  local src = debug.getinfo(1, "S").source:gsub("^@", "")
  local real = hs.fs.pathToAbsolute(src) or src
  return real:match("^(.*)/[^/]*$") or "."
end
local APP_DIR = appDir()
local HUD_FILE = APP_DIR .. "/hud/hud.html"
local ONBOARD_FILE = APP_DIR .. "/onboarding/index.html"

local MSG = {
  server = "Can't reach speech engine — restart it from the menu bar",
  mic = "Microphone access needed — allow it in Settings",
  paste = "Copied instead — press ⌘V to paste",
  generic = "Something went wrong — try again",
}

local recorder, menu
local state = "idle" -- idle | recording | transcribing
local refreshMenu -- forward decl

-- JSON-encode any Lua value as a JS literal.
local function js(v)
  if v == nil then return "undefined" end
  return hs.json.encode({v}):sub(2, -2)
end

-- ── HUD ──────────────────────────────────────────────────────────────────
local HUD_W, HUD_H, HUD_BOTTOM = 320, 96, 48
local hud = {wv = nil, ready = false, failed = false, exitMs = 200, timers = {}}
local canvas -- fallback pill

local function hudFrame()
  local s = hs.screen.mainScreen():frame()
  return {x = s.x + (s.w - HUD_W) / 2, y = s.y + s.h - HUD_H - HUD_BOTTOM, w = HUD_W, h = HUD_H}
end

local function cancelHudTimers()
  for _, t in ipairs(hud.timers) do t:stop() end
  hud.timers = {}
end

local function later(sec, fn) table.insert(hud.timers, hs.timer.doAfter(sec, fn)) end

-- Fallback: the old static canvas pill (no motion).
local CANVAS_LABELS = {listening = "Listening…", transcribing = "Transcribing…", done = "Pasted",
                       cancelled = "Cancelled", error = "Something went wrong"}
local CANVAS_DOTS = {listening = {red = 1, green = 0.25, blue = 0.25, alpha = 1},
                     transcribing = {red = 0.3, green = 0.6, blue = 1, alpha = 1},
                     done = {red = 0.2, green = 0.8, blue = 0.4, alpha = 1},
                     cancelled = {white = 0.6, alpha = 1},
                     error = {red = 1, green = 0.7, blue = 0.2, alpha = 1}}

local function canvasState(st, payload)
  if st == "hidden" then if canvas then canvas:delete(); canvas = nil end; return end
  if not canvas then
    local screen = hs.screen.mainScreen():frame()
    local w, h = 260, 44
    canvas = hs.canvas.new({x = screen.x + (screen.w - w) / 2, y = screen.y + screen.h - h - 60, w = w, h = h})
    canvas:level(hs.canvas.windowLevels.overlay)
    canvas:behavior({"canJoinAllSpaces", "stationary"})
    canvas[1] = {type = "rectangle", action = "fill", roundedRectRadii = {xRadius = 22, yRadius = 22},
                 fillColor = {red = 0.11, green = 0.11, blue = 0.12, alpha = 0.92}}
    canvas[2] = {type = "circle", action = "fill", center = {x = 26, y = h / 2}, radius = 6,
                 fillColor = CANVAS_DOTS.listening}
    canvas[3] = {type = "text", text = "", frame = {x = 44, y = 12, w = w - 54, h = 24},
                 textColor = {white = 1}, textSize = 14, textFont = ".AppleSystemUIFont",
                 textLineBreak = "truncateTail"}
    canvas:show()
  end
  local label = CANVAS_LABELS[st] or ""
  if st == "error" and payload and payload.message then label = payload.message end
  if st == "done" and not (payload and payload.text and payload.text ~= "") then label = "Nothing heard" end
  canvas[3].text = label
  canvas[2].fillColor = CANVAS_DOTS[st] or CANVAS_DOTS.listening
end

local function useWebview() return hud.wv and hud.ready and not hud.failed end

local function hudEval(code)
  if hud.wv then hud.wv:evaluateJavaScript(code) end
end

local function buildHud()
  if not hs.webview or not hs.fs.attributes(HUD_FILE) then hud.failed = true; return end
  local ok, wv = pcall(function()
    return hs.webview.new(hudFrame(), {developerExtrasEnabled = false})
  end)
  if not ok or not wv then hud.failed = true; return end
  wv:windowStyle({"borderless", "nonactivating"})
  wv:transparent(true)
  wv:allowTextEntry(false)
  wv:shadow(false)
  wv:level(hs.drawing.windowLevels.overlay)
  wv:behavior(hs.drawing.windowBehaviors.canJoinAllSpaces + hs.drawing.windowBehaviors.stationary)
  wv:navigationCallback(function(action, _, _, err)
    if action == "didFinishNavigation" then
      hud.ready = true
      wv:evaluateJavaScript("typeof window.EXIT_MS === 'number' ? window.EXIT_MS : 200", function(v)
        if type(v) == "number" then hud.exitMs = v end
      end)
      -- warm up: render once offscreen-invisible, then hide
      wv:alpha(0); wv:show()
      hs.timer.doAfter(0.1, function()  -- untracked on purpose: must always restore alpha
        if state == "idle" then wv:hide() end
        wv:alpha(1)
      end)
    elseif action == "didFail" or action == "didFailProvisionalNavigation" then
      hud.failed = true
      print("freedictate: HUD failed to load: " .. tostring(err and err.localizedDescription))
    end
  end)
  wv:url("file://" .. HUD_FILE)
  hud.wv = wv
end

local function hudHideWindow()
  later(hud.exitMs / 1000 + 0.03, function()
    if hud.wv then hud.wv:hide() end
  end)
end

-- Send a state to the HUD (or the fallback). Any new state cancels pending hide timers.
local function hudState(st, payload)
  cancelHudTimers()
  if not useWebview() then canvasState(st, payload); return end
  if st ~= "hidden" then
    hud.wv:frame(hudFrame())
    hud.wv:show()
  end
  hudEval("window.setState && window.setState(" .. js(st) .. (payload and ("," .. js(payload)) or "") .. ")")
  if st == "hidden" then hudHideWindow() end
end

-- Show a terminal state, then hide after `hold` seconds.
local function hudFlash(st, payload, hold)
  hudState(st, payload)
  later(hold, function()
    if useWebview() then
      hudEval("window.setState && window.setState('hidden')")
      hudHideWindow()
    else
      canvasState("hidden")
    end
  end)
end

local lastLevel, lastLevelAt = -1, 0
local function hudLevel(x)
  if not useWebview() or state ~= "recording" then return end
  local now = hs.timer.secondsSinceEpoch()
  if now - lastLevelAt < 1 / 15 then return end
  x = math.floor(x * 100 + 0.5) / 100
  if math.abs(x - lastLevel) < 0.02 then return end
  lastLevel, lastLevelAt = x, now
  hudEval("window.setLevel && window.setLevel(" .. x .. ")")
end

-- RMS dBFS → 0..1: map −60..−10 dB, gamma 0.6.
local function dbToLevel(db)
  local x = (db + 60) / 50
  if x < 0 then x = 0 elseif x > 1 then x = 1 end
  return x ^ 0.6
end

-- ── Paste / transcribe ───────────────────────────────────────────────────
local function paste(text)
  if not hs.accessibilityState() then
    hs.pasteboard.setContents(text) -- no restore: the text stays on the clipboard
    return false
  end
  local saved = hs.pasteboard.readAllData()
  hs.pasteboard.setContents(text)
  hs.eventtap.keyStroke({"cmd"}, "v", 0)
  hs.timer.doAfter(0.4, function()
    if saved then hs.pasteboard.writeAllData(saved) end
  end)
  return true
end

local function clean(out)
  if not out then return "" end
  out = out:gsub("%[BLANK_AUDIO%]", ""):gsub("%(%s*[Ss]ilence%s*%)", "")
  out = out:gsub("\n", " "):gsub("%s+", " ")
  return (out:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function finish(text, failed)
  state = "idle"
  refreshMenu()
  if failed then hudFlash("error", {message = MSG.server}, 2.4); return end
  text = clean(text)
  if text == "" then hudFlash("done", {text = ""}, 0.42); return end
  if paste(text) then
    hudFlash("done", {text = text}, 0.7)
  else
    hudFlash("error", {message = MSG.paste}, 2.4)
  end
end

local function transcribeCli()
  hs.task.new(WHISPER_CLI, function(code, out) finish(out, code ~= 0) end,
    {"-m", MODEL, "-f", WAV, "-nt", "-np"}):start()
end

local function transcribe()
  state = "transcribing"
  refreshMenu()
  hudState("transcribing")
  hs.task.new(CURL, function(code, out)
    local ok = code == 0 and out and not out:match('^%s*{%s*"error"')
    if ok then finish(out) else transcribeCli() end
  end, {"-s", "--fail", "--max-time", "60", SERVER, "-F", "file=@" .. WAV,
        "-F", "response_format=text", "-F", "temperature=0"}):start()
end

local stopping = false
local function stopRecording(cancel)
  if recorder and recorder:isRunning() then
    stopping = true
    recorder:setCallback(function()
      stopping = false
      if cancel then state = "idle"; refreshMenu() else transcribe() end
    end)
    if cancel then
      hudFlash("cancelled", nil, 0.5)
    end
    recorder:interrupt() -- SIGINT lets ffmpeg finalize the wav header
  else
    state = "idle"
    hudState("hidden")
  end
end

local function startRecording()
  os.remove(WAV)
  state = "recording"
  lastLevel, lastLevelAt = -1, 0
  hudState("listening")
  local buf = ""
  recorder = hs.task.new(FFMPEG,
    function(code)            -- exited on its own (no SIGINT from us): mic denied / no input
      if state == "recording" and not stopping then
        state = "idle"; refreshMenu()
        hudFlash("error", {message = MSG.mic}, 2.4)
        print("freedictate: ffmpeg exited early, code " .. tostring(code))
      end
    end,
    function(_, out, err)     -- stream: RMS lines arrive on stderr (av_log is unbuffered;
      -- ametadata file=- goes through avio buffering and only flushes at exit)
      buf = buf .. (out or "") .. (err or "")
      local lastNl = buf:match(".*()\n")
      if not lastNl then return true end
      local complete = buf:sub(1, lastNl)
      buf = buf:sub(lastNl + 1)
      local db
      for v in complete:gmatch("RMS_level=([%-%d%.inf]+)") do db = tonumber(v) or -100 end
      if db then hudLevel(dbToLevel(db)) end
      return true
    end,
    {"-hide_banner", "-nostats", "-loglevel", "info", "-f", "avfoundation", "-i", ":default",
     "-af", "astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level",
     "-ar", "16000", "-ac", "1", "-y", WAV})
  recorder:start()
end


-- ── Talk key: tap to start / tap to stop, or hold and release ──────────────
local HOLD_THRESHOLD = 0.35
local MOD_KEYCODES = {[54]="cmd",[55]="cmd",[56]="shift",[60]="shift",[58]="alt",[61]="alt",
                      [59]="ctrl",[62]="ctrl",[63]="fn"}
local MOD_NAMES = {[54]="Right ⌘",[55]="Left ⌘",[56]="Left ⇧",[60]="Right ⇧",[58]="Left ⌥",
                   [61]="Right ⌥",[59]="Left ⌃",[62]="Right ⌃",[63]="Fn"}
local SYM = {cmd="⌘", alt="⌥", ctrl="⌃", shift="⇧", fn="Fn "}
local DEFAULT_KEY = {keyCode = 49, mods = {"alt"}}  -- ⌥Space

local talkKey = getSetting("talkKey") or DEFAULT_KEY
local tap, capturing, holdTimer
local keyIsDown, pressedAt, startedByThisPress = false, 0, false
local onboard -- onboarding webview

local MOUSE_NAMES = {[2]="Middle mouse button",[3]="Mouse Back button",[4]="Mouse Forward button"}

local function keyLabel(k)
  if k.mouseButton then return MOUSE_NAMES[k.mouseButton] or ("Mouse button " .. (k.mouseButton + 1)) end
  if k.modOnly then return MOD_NAMES[k.keyCode] or ("key " .. k.keyCode) end
  local s = ""
  for _, m in ipairs({"ctrl", "alt", "shift", "cmd", "fn"}) do
    for _, km in ipairs(k.mods) do if km == m then s = s .. SYM[m] end end
  end
  local name = hs.keycodes.map[k.keyCode] or ("key " .. k.keyCode)
  return s .. (#name == 1 and name:upper() or name:gsub("^%l", string.upper))
end

local function activeMods(flags)
  local out = {}
  for _, m in ipairs({"cmd", "alt", "ctrl", "shift", "fn"}) do if flags[m] then table.insert(out, m) end end
  return out
end

local function modsMatch(flags, want)
  for _, m in ipairs({"cmd", "alt", "ctrl", "shift"}) do
    local w = false
    for _, x in ipairs(want) do if x == m then w = true end end
    if (flags[m] or false) ~= w then return false end
  end
  return true
end

-- Menubar template icons (monochrome mic), drawn from inline SVG.
local ICON_SVG = {
  idle = '<rect x="6.5" y="2" width="5" height="9" rx="2.5" fill="none" stroke="#000" stroke-width="1.4"/>',
  recording = '<rect x="6.5" y="2" width="5" height="9" rx="2.5" fill="#000"/><circle cx="15" cy="3" r="2" fill="#000"/>',
  transcribing = '<rect x="6.5" y="2" width="5" height="9" rx="2.5" fill="none" stroke="#000" stroke-width="1.4"/>'
    .. '<circle cx="13.5" cy="15.5" r=".9" fill="#000"/><circle cx="15.5" cy="15.5" r=".9" fill="#000"/><circle cx="17.3" cy="15.5" r=".9" fill="#000"/>',
}
local ICON_STEM = '<path d="M4 8.5a5 5 0 0 0 10 0M9 13.5V16" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round"/>'
local icons = {}
local function loadIcons()
  for name, body in pairs(ICON_SVG) do
    local path = os.tmpname() .. ".svg"
    local f = io.open(path, "w")
    if f then
      f:write('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">'
              .. body .. ICON_STEM .. '</svg>')
      f:close()
      local ok, img = pcall(hs.image.imageFromPath, path)
      if ok and img then icons[name] = img:template(true) end
      os.remove(path)
    end
  end
end

refreshMenu = function()
  if not menu then return end
  local key = state == "recording" and "recording" or (state == "transcribing" and "transcribing" or "idle")
  if icons[key] then
    menu:setIcon(icons[key], true)
  else
    menu:setTitle(state == "recording" and "● FreeDictate" or "FreeDictate")
  end
  menu:setTooltip("FreeDictate — " .. keyLabel(talkKey))
end

local function stopHoldTimer() if holdTimer then holdTimer:stop(); holdTimer = nil end end

local function onPress()
  keyIsDown, pressedAt = true, hs.timer.secondsSinceEpoch()
  if state == "idle" then
    startedByThisPress = true
    startRecording()
    stopHoldTimer()
    holdTimer = hs.timer.doAfter(HOLD_THRESHOLD, function()
      holdTimer = nil
      if keyIsDown and startedByThisPress and state == "recording" then
        hudState("listening", {mode = "hold"})
      end
    end)
  elseif state == "recording" then
    startedByThisPress = false
    stopRecording(false)            -- second tap stops
  end
  refreshMenu()
end

local function onRelease()
  keyIsDown = false
  stopHoldTimer()
  local held = hs.timer.secondsSinceEpoch() - pressedAt
  if startedByThisPress and state == "recording" then
    if held >= HOLD_THRESHOLD then
      stopRecording(false)          -- hold mode: release stops
    else
      hudState("listening", {mode = "tap"}) -- latched: tap again to stop
    end
  end
  startedByThisPress = false
  refreshMenu()
end

local function setKey(k)
  talkKey = k
  setSetting("talkKey", k)
  refreshMenu()
  hs.alert.show("Talk key: " .. keyLabel(k), 1.5)
  if onboard then onboard:evaluateJavaScript("window.onKeyChanged && window.onKeyChanged(" .. js(keyLabel(k)) .. ")") end
end

local captureModDown
local function beginCapture()
  if state ~= "idle" then return end
  capturing, captureModDown = true, nil
  hs.alert.show("Press a key, combo, or extra mouse button for talking  (Esc to cancel)", 4)
end

local function endCaptureCancelled()
  capturing = false; hs.alert.closeAll(); hs.alert.show("Cancelled", 1)
  if onboard then onboard:evaluateJavaScript("window.onKeyChanged && window.onKeyChanged(" .. js(keyLabel(talkKey)) .. ")") end
end

local function handle(e)
  local t, code, flags = e:getType(), e:getKeyCode(), e:getFlags()
  local T = hs.eventtap.event.types
  local isMouse = (t == T.otherMouseDown or t == T.otherMouseUp)
  local button = isMouse and e:getProperty(hs.eventtap.event.properties.mouseEventButtonNumber) or nil

  if isMouse then
    if capturing then
      if t == T.otherMouseDown then
        capturing = false; hs.alert.closeAll()
        setKey({mouseButton = button})
      end
      return true
    end
    if talkKey.mouseButton == button then
      if t == T.otherMouseDown and not keyIsDown then onPress() elseif t == T.otherMouseUp and keyIsDown then onRelease() end
      return true
    end
    return false
  end

  if capturing then
    if t == T.keyDown then
      if code == 53 then endCaptureCancelled(); return true end
      capturing = false; hs.alert.closeAll()
      setKey({keyCode = code, mods = activeMods(flags)})
      return true
    elseif t == T.flagsChanged and MOD_KEYCODES[code] then
      local down = flags[MOD_KEYCODES[code]]
      if down then captureModDown = code
      elseif captureModDown == code then
        capturing = false; hs.alert.closeAll()
        setKey({keyCode = code, mods = {}, modOnly = true})
      end
    end
    return false
  end

  -- Esc cancels a recording in progress
  if t == T.keyDown and code == 53 and state == "recording" then
    stopHoldTimer(); keyIsDown = false; startedByThisPress = false
    stopRecording(true); refreshMenu(); return true
  end

  if talkKey.mouseButton then return false end

  if talkKey.modOnly then
    if t == T.flagsChanged and code == talkKey.keyCode then
      local down = flags[MOD_KEYCODES[code]] or false
      if down and not keyIsDown then onPress() elseif not down and keyIsDown then onRelease() end
    end
    return false
  end

  if code == talkKey.keyCode then
    if t == T.keyDown and modsMatch(flags, talkKey.mods) then
      if not e:getProperty(hs.eventtap.event.properties.keyboardEventAutorepeat) or e:getProperty(hs.eventtap.event.properties.keyboardEventAutorepeat) == 0 then
        if not keyIsDown then onPress() end
      end
      return true
    elseif t == T.keyUp and keyIsDown then
      onRelease()
      return true
    end
  end
  return false
end

-- ── Onboarding window ────────────────────────────────────────────────────
-- Best-effort mic check: record 0.3s with ffmpeg; ok = exit 0 and a non-empty wav.
-- Skipped (reports nil) while dictating, since the device is busy.
local micTest
local function testMicrophone(cb)
  if state ~= "idle" or (micTest and micTest:isRunning()) then cb(nil); return end
  os.remove(MIC_TEST_WAV)
  micTest = hs.task.new(FFMPEG, function(code)
    micTest = nil
    local attr = hs.fs.attributes(MIC_TEST_WAV)
    local ok = code == 0 and attr ~= nil and attr.size > 1024 -- > wav header
    os.remove(MIC_TEST_WAV)
    cb(ok)
  end, {"-hide_banner", "-nostats", "-loglevel", "error", "-f", "avfoundation", "-i", ":default",
        "-t", "0.3", "-ar", "16000", "-ac", "1", "-y", MIC_TEST_WAV})
  if not micTest:start() then micTest = nil; cb(false) end
end

local function onboardInit()
  if not onboard then return end
  local pending, serverOk, mic = 2, false, nil
  local function done()
    pending = pending - 1
    if pending > 0 or not onboard then return end
    onboard:evaluateJavaScript("window.onInit && window.onInit(" .. js({
      keyLabel = keyLabel(talkKey), serverOk = serverOk, accessibility = hs.accessibilityState(),
      microphone = mic, launchAtLogin = hs.autoLaunch(),
    }) .. ")")
  end
  hs.http.asyncGet(SERVER_ROOT, nil, function(status)
    serverOk = type(status) == "number" and status > 0; done()
  end)
  testMicrophone(function(ok) mic = ok; done() end)
end

-- Restart the speech engine LaunchAgent (new label, falling back to the legacy one).
local function startServer()
  local uid = hs.execute("id -u"):gsub("%s+", "")
  local _, ok = hs.execute("launchctl kickstart -k gui/" .. uid .. "/" .. LABEL .. " 2>/dev/null")
  if not ok then hs.execute("launchctl kickstart -k gui/" .. uid .. "/" .. OLD_LABEL .. " 2>/dev/null") end
  -- give whisper-server a moment to load the model before re-reporting status
  hs.timer.doAfter(3, onboardInit)
end

-- Preview a HUD state without recording, e.g. hs -c 'require("freedictate").preview("done", {text="Hi"})'
function M.preview(st, payload) hudState(st, payload) end

function M.showOnboarding()
  if onboard then onboard:show():bringToFront(true); return end
  if not hs.fs.attributes(ONBOARD_FILE) then hs.alert.show("Onboarding page missing", 2); return end
  local ucc = hs.webview.usercontent.new("dictate")
  ucc:setCallback(function(msg)
    local a = type(msg.body) == "table" and msg.body.action or nil
    if a == "setKey" then beginCapture()
    elseif a == "resetKey" then setKey(DEFAULT_KEY)
    elseif a == "close" then
      setSetting("onboarded", true)
      hs.timer.doAfter(0, function() if onboard then onboard:delete(); onboard = nil end end)
    elseif a == "openAccessibility" then
      hs.execute("open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'")
    elseif a == "openMicrophone" then
      hs.execute("open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'")
    elseif a == "startServer" then startServer()
    elseif a == "launchAtLogin" then hs.autoLaunch(true); onboardInit()
    elseif a == "recheck" then onboardInit()
    end
  end)
  local s = hs.screen.mainScreen():frame()
  local w, h = 520, 560
  onboard = hs.webview.new({x = s.x + (s.w - w) / 2, y = s.y + (s.h - h) / 2, w = w, h = h}, {}, ucc)
  onboard:windowStyle({"titled", "closable", "miniaturizable"})
  onboard:windowTitle("FreeDictate Setup")
  onboard:allowTextEntry(true)
  onboard:deleteOnClose(true)
  onboard:windowCallback(function(action)
    if action == "closing" then setSetting("onboarded", true); onboard = nil end
  end)
  onboard:navigationCallback(function(action)
    if action == "didFinishNavigation" then onboardInit() end
  end)
  onboard:url("file://" .. ONBOARD_FILE)
  onboard:show():bringToFront(true)
  hs.focus()
end

function M.start()
  local T = hs.eventtap.event.types
  tap = hs.eventtap.new({T.keyDown, T.keyUp, T.flagsChanged, T.otherMouseDown, T.otherMouseUp}, handle)
  tap:start()
  -- macOS can silently disable a tap; keep it alive
  M.watchdog = hs.timer.doEvery(5, function() if not tap:isEnabled() then tap:start() end end)

  pcall(buildHud)
  pcall(loadIcons)

  menu = hs.menubar.new()
  menu:setMenu(function()
    return {
      {title = "Talk key: " .. keyLabel(talkKey), disabled = true},
      {title = "Tap to start/stop, or hold and release", disabled = true},
      {title = "-"},
      {title = "Set talk key…", fn = beginCapture},
      {title = "Reset to ⌥Space", fn = function() setKey(DEFAULT_KEY) end},
      {title = "-"},
      {title = "Setup…", fn = M.showOnboarding},
    }
  end)
  refreshMenu()

  -- First run: make Hammerspoon (and thus FreeDictate) start at login.
  if not getSetting("autoLaunchSet") then hs.autoLaunch(true); setSetting("autoLaunchSet", true) end

  if not getSetting("onboarded") then hs.timer.doAfter(1, M.showOnboarding) end
end

return M
