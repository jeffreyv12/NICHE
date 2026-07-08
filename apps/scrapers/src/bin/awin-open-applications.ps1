# Opens Awin programme detail pages so you can click "Join" for each one.
# Run from PowerShell: .\apps\scrapers\src\bin\awin-open-applications.ps1

$publisherId = "2943451"

$programmes = @(
    @{ id = "22918"; name = "Delonghi NL       — koffiezetapparaten, espresso" },
    @{ id = "22917"; name = "Delonghi BE       — koffiezetapparaten, espresso" },
    @{ id = "81677"; name = "SharkNinja NL     — robotstofzuigers, airfryers" },
    @{ id = "81675"; name = "SharkNinja BE     — robotstofzuigers, airfryers" },
    @{ id = "25897"; name = "Tefal NL          — airfryers, keukenapparaten" },
    @{ id = "69688"; name = "Tefal BE          — airfryers, keukenapparaten" },
    @{ id = "26720"; name = "AEG NL            — stofzuigers, keukenapparaten" },
    @{ id = "26719"; name = "AEG Shop NL       — onderdelen & accessoires" },
    @{ id = "21527"; name = "Nespresso NL      — koffiezetapparaten" },
    @{ id = "12484"; name = "Dyson NL          — robotstofzuigers, stofzuigers" },
    @{ id = "12909"; name = "Dyson BE          — robotstofzuigers, stofzuigers" },
    @{ id = "85165"; name = "Coolblue BE       — alles (retailer)" },
    @{ id = "9213";  name = "Allekabels NL     — elektronica retailer" },
    @{ id = "9639";  name = "Allekabels BE     — elektronica retailer" }
)

Write-Host ""
Write-Host "Awin programma-aanvragen openen..." -ForegroundColor Cyan
Write-Host "Klik 'Join' op elke pagina die opent." -ForegroundColor Yellow
Write-Host ""

foreach ($p in $programmes) {
    $url = "https://ui.awin.com/awin/affiliate/$publisherId/merchant-directory/detail/id/$($p.id)"
    Write-Host "  Opening: $($p.name)" -ForegroundColor Green
    Start-Process $url
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Alle $($programmes.Count) paginas geopend." -ForegroundColor Cyan
Write-Host "Na goedkeuring (1-7 dagen) zijn de product feeds beschikbaar." -ForegroundColor Yellow
Write-Host ""
