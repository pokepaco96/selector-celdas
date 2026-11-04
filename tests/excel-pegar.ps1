# Pega el portapapeles en un libro nuevo de una instancia oculta de Excel y escribe
# el rango resultante en un JSON. No guarda nada y cierra solo la instancia que abre.
param(
  [Parameter(Mandatory)] [ValidateSet('Html', 'Text')] [string] $Mode,
  [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'

$excel = New-Object -ComObject Excel.Application
try {
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $book = $excel.Workbooks.Add()
  $sheet = $book.Worksheets.Item(1)
  $sheet.Activate()
  [void] $sheet.Range('A1').Select()

  if ($Mode -eq 'Text') {
    # El nombre del formato depende del idioma de Excel.
    $pasted = $false
    foreach ($format in 'Texto', 'Text') {
      try {
        [void] $sheet.PasteSpecial($format)
        $pasted = $true
        break
      } catch {}
    }
    if (-not $pasted) { throw 'Excel no ofrece el formato de texto' }
  } else {
    [void] $sheet.Paste()
  }

  $used = $sheet.UsedRange
  $rows = $used.Rows.Count
  $cols = $used.Columns.Count
  $cells = @()
  $values = @()
  for ($r = 1; $r -le $rows; $r++) {
    $textRow = @()
    $valueRow = @()
    for ($c = 1; $c -le $cols; $c++) {
      $cell = $sheet.Cells.Item($r, $c)
      $textRow += [string] $cell.Text
      $valueRow += $cell.Value2
    }
    $cells += , $textRow
    $values += , $valueRow
  }

  [pscustomobject] @{
    Rows = $rows
    Columns = $cols
    Cells = $cells
    Values = $values
  } | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $Out -Encoding utf8

  $book.Close($false)
} finally {
  $excel.Quit()
  [void] [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}
