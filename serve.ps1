# Minimal static web server for testing the app on this PC: http://localhost:8080
#
# With -Api it also imitates the REST API of the central database (Supabase /
# Lovable Cloud: /rest/v1/...), stored as JSON files in -DataDir. That is only
# meant for testing the sync on this PC; the real central database is Supabase.
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -Api -TeamCode test
param(
  [int]$Port = 8080,
  [switch]$Api,
  [string]$DataDir = (Join-Path (Split-Path $PSScriptRoot) 'werkbon-centraal-test'),
  [string]$TeamCode = 'test'
)
$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.otf' = 'font/otf'; '.woff2' = 'font/woff2'
}

# ---------------------------------------------------------------------------
# Test imitation of the Supabase REST API (subset used by js/sync.js)
# ---------------------------------------------------------------------------
$tables = 'monteurs', 'klanten', 'machines', 'onderdelen', 'werkbonnen'
$db = @{}
$script:lastTs = [DateTime]::MinValue
if ($Api) {
  Add-Type -AssemblyName System.Web.Extensions
  $json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $json.MaxJsonLength = [int]::MaxValue
  New-Item -ItemType Directory -Force $DataDir | Out-Null
  foreach ($t in $tables) {
    $db[$t] = [ordered]@{}
    $f = Join-Path $DataDir "$t.json"
    if (Test-Path $f) { foreach ($r in $json.DeserializeObject([IO.File]::ReadAllText($f))) { $db[$t][$r['id']] = $r } }
  }
}

function Send-Body($res, [int]$status, [string]$body, [string]$type = 'application/json; charset=utf-8') {
  $res.StatusCode = $status
  $res.ContentType = $type
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

# Like Postgres clock_timestamp(): strictly increasing, microsecond precision
function New-Timestamp {
  $now = [DateTime]::UtcNow
  if ($now -le $script:lastTs) { $now = $script:lastTs.AddTicks(10) }
  $script:lastTs = $now
  $now.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'+00:00'")
}

function Test-Filter($value, [string]$expr) {
  $i = $expr.IndexOf('.')
  $op = $expr.Substring(0, $i); $arg = $expr.Substring($i + 1)
  if ($value -is [bool]) { $value = "$value".ToLower() }
  $a = [string]$value
  $da = [DateTimeOffset]::MinValue; $db2 = [DateTimeOffset]::MinValue
  $isDate = [DateTimeOffset]::TryParse($a, [ref]$da) -and [DateTimeOffset]::TryParse($arg, [ref]$db2) -and $a -match '^\d{4}-\d\d-\d\dT'
  $cmp = if ($isDate) { $da.CompareTo($db2) } else { [string]::CompareOrdinal($a, $arg) }
  switch ($op) {
    'eq' { return $cmp -eq 0 }
    'neq' { return $cmp -ne 0 }
    'gt' { return $cmp -gt 0 }
    'gte' { return $cmp -ge 0 }
    'lt' { return $cmp -lt 0 }
    'lte' { return $cmp -le 0 }
    'like' { return $a -cmatch ('^' + ([regex]::Escape($arg) -replace '\\\*', '.*') + '$') }
    default { throw "Filter $op wordt niet ondersteund" }
  }
}

function Invoke-Api($ctx, [string]$rel) {
  $req = $ctx.Request; $res = $ctx.Response
  $res.Headers.Add('Access-Control-Allow-Origin', '*')
  $res.Headers.Add('Access-Control-Allow-Headers', 'apikey, authorization, content-type, prefer, x-team-code, x-client-info')
  $res.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204; return }
  if (-not $req.Headers['apikey']) { Send-Body $res 401 '{"message":"No API key found in request"}'; return }
  # Same effect as the row-level security policies: wrong team code = no rows, no writes
  $ok = $req.Headers['x-team-code'] -ceq $TeamCode

  if ($rel -eq 'rpc/werkbon_teamcode_ok') { Send-Body $res 200 ($(if ($ok) { 'true' } else { 'false' })); return }
  if ($tables -notcontains $rel) { Send-Body $res 404 "{`"message`":`"relation public.$rel does not exist`"}"; return }

  $q = [ordered]@{}
  foreach ($part in $req.Url.Query.TrimStart('?').Split('&')) {
    if (-not $part) { continue }
    $kv = $part.Split('=', 2)
    $q[[Uri]::UnescapeDataString($kv[0])] = [Uri]::UnescapeDataString($kv[1])
  }

  if ($req.HttpMethod -eq 'GET') {
    $rows = if ($ok) { @($db[$rel].Values) } else { @() }
    foreach ($k in $q.Keys) {
      if ('select', 'order', 'limit', 'offset' -contains $k) { continue }
      $expr = $q[$k]
      $rows = @($rows | Where-Object { Test-Filter $_[$k] $expr })
    }
    if ($q['order']) {
      $props = foreach ($o in $q['order'].Split(',')) {
        $p = $o.Split('.'); $col = $p[0]
        @{ Expression = [scriptblock]::Create("`$_['$col']"); Descending = ($p[1] -eq 'desc') }
      }
      $rows = @($rows | Sort-Object -Property $props)
    }
    $offset = if ($q['offset']) { [int]$q['offset'] } else { 0 }
    $limit = if ($q['limit']) { [int]$q['limit'] } else { 1000 }
    $rows = @($rows | Select-Object -Skip $offset -First $limit)
    if ($q['select'] -and $q['select'] -ne '*') {
      $cols = $q['select'].Split(',')
      $rows = @(foreach ($r in $rows) { $o = [ordered]@{}; foreach ($c in $cols) { $o[$c] = $r[$c] }; $o })
    }
    Send-Body $res 200 $json.Serialize([object[]]$rows)
    return
  }

  if ($req.HttpMethod -eq 'POST') {
    if (-not $ok) { Send-Body $res 401 "{`"code`":`"42501`",`"message`":`"new row violates row-level security policy for table \`"$rel\`"`"}"; return }
    $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
    $items = $json.DeserializeObject($body)
    if ($items -isnot [array]) { $items = @($items) }
    foreach ($it in $items) {
      $id = [string]$it['id']
      $row = if ($db[$rel].Contains($id)) { $db[$rel][$id] } else { @{ id = $id; verwijderd = $false; gewijzigd_door = $null } }
      foreach ($k in $it.Keys) { $row[$k] = $it[$k] }
      $row['bijgewerkt_op'] = New-Timestamp
      $d = $row['data']
      if ($rel -eq 'werkbonnen') {
        $row['nummer'] = $d['nummer']; $row['datum'] = $d['datum']; $row['status'] = $d['status']; $row['monteur'] = $d['monteur']
        $row['klant_naam'] = if ($d['klant']) { $d['klant']['naam'] } else { $null }
      }
      $db[$rel][$id] = $row
    }
    [IO.File]::WriteAllText((Join-Path $DataDir "$rel.json"), $json.Serialize([object[]]@($db[$rel].Values)), [Text.Encoding]::UTF8)
    Write-Host ("{0:HH:mm:ss} API: {1} rij(en) ontvangen in {2}" -f (Get-Date), $items.Count, $rel)
    $res.StatusCode = 201
    return
  }
  Send-Body $res 405 '{"message":"Methode niet ondersteund"}'
}

# ---------------------------------------------------------------------------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Werkbonnen draait op http://localhost:$Port/  (Ctrl+C om te stoppen)"
if ($Api) { Write-Host "Test-API (centrale database): http://localhost:$Port  teamcode: $TeamCode  gegevens: $DataDir" }
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($Api -and $path.StartsWith('rest/v1/')) { Invoke-Api $ctx $path.Substring(8); continue }
      if (-not $path) { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path))
      if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else {
        $res.StatusCode = 404
      }
    } catch {
      Write-Host "Fout bij $($ctx.Request.Url): $_"
      try { Send-Body $res 500 ('{"message":' + (ConvertTo-Json "$_") + '}') } catch { }
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
