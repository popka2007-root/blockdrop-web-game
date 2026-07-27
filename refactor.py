import os
import re
import json

with open('server.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def get_funcs():
    funcs = []
    braceCount = 0
    inFunc = False
    funcStart = 0
    funcName = ""

    for i, line in enumerate(lines):
        if braceCount == 0 and line.startswith('function '):
            inFunc = True
            funcStart = i
            funcName = line.split('(')[0].replace('function ', '').strip()
        
        if inFunc:
            braceCount += line.count('{')
            braceCount -= line.count('}')
            if braceCount == 0:
                inFunc = False
                funcs.append({
                    "name": funcName,
                    "start": funcStart,
                    "end": i,
                    "code": "".join(lines[funcStart:i+1])
                })
    return funcs

funcs = get_funcs()

http_names = ['safeDecodePath', 'handleHealth', 'handleLiveness', 'handleReadiness', 'sendHealthPayload', 'handleMetrics', 'hasMetricsAccess', 'timingSafeEqualText', 'serverDateKey', 'livePlayersCount', 'liveSpectatorsCount', 'updateLiveMetrics', 'readRevision', 'readPackageMeta', 'handleCapabilitiesApi', 'isFeatureEnabled', 'handleQrApi', 'handleRecordsApi', 'handleDailyApi', 'handleDailyRunApi', 'handleAccountApi', 'handleRankedApi', 'readJsonRequest', 'handleProfileTransferApi', 'handleAnalyticsApi', 'authTokenFromRequest', 'accountFromRequest', 'sanitizeRecord', 'sanitizeDailyScore', 'isPlausibleRecord', 'isPlausibleDailyScore', 'verifyDailyReplay', 'parseTimeSeconds', 'sendJson', 'writeHead', 'allowHttpRequest', 'sendRateLimited']

match_names = ['joinRoom', 'validateMatchEventPayload', 'joinRankedQueue', 'removeQueuedClient', 'findReconnectSlot', 'clearReconnect', 'updateClientState', 'startTournament', 'maybeAutoStart', 'startRankedSeries', 'startCountdown', 'startAuthoritativeMatch', 'stopAuthoritativeMatch', 'queueAuthoritativeInput', 'drainAuthoritativeInputs', 'tickAuthoritativeMatch', 'finishAuthoritativeResult', 'updateClientFromEngine', 'formatTickTime', 'authoritativeOpponentPayload', 'sendAuthoritativeSnapshot', 'sendAuthoritativeSnapshots', 'markRematchReady', 'finishMatchFromClient', 'finishMatch', 'persistAuthoritativeReplays', 'finalizeRankedMatch', 'recordMatchEvent', 'maxAttackForEvent', 'rankedParticipant', 'applyRankedProfileToParticipant', 'rankedResultPayload']

ws_names = ['createClient', 'isAllowedWebSocketOrigin', 'allowedWebSocketOrigins', 'emptyState', 'createRoom', 'handleMessage', 'validateInputShape', 'inputTargetsActiveMatch', 'isSafePayload', 'hasOnlyKeys', 'isIntegerInRange', 'isSafeShortText', 'hasUnsafeTextChars', 'matchesClientRoom', 'validateJoinPayload', 'validateTournamentPayload', 'validateUpdatePayload', 'validateAttackPayload', 'isSafeBoardPreview', 'allowMessage', 'allowTypedMessage', 'allowAttackLines', 'consumeAttackCredit', 'safeClose', 'scheduleTournamentEnd', 'broadcastAttack', 'broadcastRoom', 'broadcast', 'send', 'tournamentPayload', 'matchPayload', 'seriesPayload', 'playersPayload', 'spectatorsPayload', 'removeClient', 'cleanPlayerId', 'cleanName', 'safeNumber', 'clamp', 'pruneProductData']

context_keys = "crypto fs zlib http path QRCode WebSocket WebSocketServer createMetrics createLogger clientAddress isSensitiveTransportAllowed RANKED_MAX_RATING RANKED_MIN_RATING createServerStore protocol engine PORT ROOT MAX_WS_FRAME_BYTES MAX_MESSAGES_PER_10S MAX_UPDATES_PER_SECOND MAX_ATTACKS_PER_SECOND MAX_ATTACK_LINES_PER_10S MAX_PAYLOAD_KEYS HTTP_RATE_WINDOW_MS RECONNECT_GRACE_MS COUNTDOWN_STEP_MS MATCH_TICK_MS SNAPSHOT_INTERVAL_TICKS RANKED_K_FACTOR ATTACK_KEY_LIST MAX_BOARD_PREVIEW_COLS MAX_BOARD_PREVIEW_ROWS JOIN_KEY_LIST INPUT_ACTIONS INPUT_KEY_LIST MATCH_OVER_KEY_LIST MAX_RECORD_SCORE PING_KEY_LIST PROTOCOL_VERSION SUPPORTED_PROTOCOL_VERSIONS REMATCH_KEY_LIST MATCH_EVENT_KEY_LIST ROOM_PLAYER_LIMIT TOURNAMENT_KEY_LIST UPDATE_KEY_LIST normalizeIdentityToken normalizeMatchMode normalizePlayerId normalizePlayerName normalizeRoomId sanitizeBoardPreview UPDATE_KEYS ATTACK_KEYS REMATCH_KEYS MATCH_EVENT_KEYS MATCH_OVER_KEYS PING_KEYS JOIN_KEYS INPUT_KEYS TOURNAMENT_KEYS rooms rankedQueue httpRateBuckets startedAt cachedPackageMeta store logger metrics eventLoopExpectedAt previousCpuUsage previousCpuMeasuredAt operationalMetricsTimer mime securityHeaders PUBLIC_ROOT_FILES PUBLIC_PREFIXES".split()

def generate_module(names, setup_name):
    mod_funcs = [f for f in funcs if f["name"] in names]
    
    out = "module.exports = function " + setup_name + "(context) {\n"
    out += "  const { " + ", ".join(context_keys) + " } = context;\n\n"
    
    all_func_names = [f["name"] for f in funcs]
    other_funcs = [n for n in all_func_names if n not in names]
    out += "  const { " + ", ".join(other_funcs) + " } = context;\n\n"
    
    for f in mod_funcs:
        out += f["code"] + "\n"
        
    out += "  return {\n"
    for n in names:
        out += f"    {n},\n"
    out += "  };\n};\n"
    return out

os.makedirs('src/server', exist_ok=True)

with open('src/server/http.js', 'w', encoding='utf-8') as f:
    f.write(generate_module(http_names, 'setupHttp'))

with open('src/server/ws.js', 'w', encoding='utf-8') as f:
    f.write(generate_module(ws_names, 'setupWs'))

with open('src/server/matchmaking.js', 'w', encoding='utf-8') as f:
    f.write(generate_module(match_names, 'setupMatchmaking'))

server_out = []
func_start_line = min(f["start"] for f in funcs)

for i in range(func_start_line):
    server_out.append(lines[i])

server_out.append("\n// --- WIRED MODULES ---\n")
server_out.append("const setupHttp = require('./src/server/http.js');\n")
server_out.append("const setupWs = require('./src/server/ws.js');\n")
server_out.append("const setupMatchmaking = require('./src/server/matchmaking.js');\n\n")

server_out.append("const context = {\n")
for k in context_keys:
    server_out.append(f"  {k},\n")
server_out.append("};\n\n")

server_out.append("const httpModule = setupHttp(context);\n")
server_out.append("const wsModule = setupWs(context);\n")
server_out.append("const matchmakingModule = setupMatchmaking(context);\n\n")

server_out.append("Object.assign(context, httpModule, wsModule, matchmakingModule);\n\n")
server_out.append("Object.assign(globalThis, httpModule, wsModule, matchmakingModule);\n\n")

unassigned = [f for f in funcs if f["name"] not in http_names + match_names + ws_names]
for f in unassigned:
    server_out.append(f["code"] + "\n")
    server_out.append(f"context.{f['name']} = {f['name']};\n")
    server_out.append(f"globalThis.{f['name']} = {f['name']};\n")

# Wait, the HTTP server callbacks use the un-namespaced functions (e.g., `handleCapabilitiesApi`).
# Let's inject them into the global scope or simply do this inside server.js because the HTTP server creation is above func_start_line!
# Wait! In JS, if we put `httpModule.handleCapabilitiesApi` we have to change the calls.
# BUT `http.createServer` is above func_start_line. So it calls `handleCapabilitiesApi()` assuming it's available.
# We can't use globalThis for `const` functions in older JS but here we can just assign them to `global`.
# Or even better, we can replace the calls in the server_out array!
# We can use regex to replace `handleCapabilitiesApi(` with `httpModule.handleCapabilitiesApi(`.

with open('server.js', 'w', encoding='utf-8') as f:
    f.writelines(server_out)

print("Done generating files.")
