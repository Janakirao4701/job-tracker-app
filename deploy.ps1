# deploy.ps1
# This script automatically syncs app.html to index.html and pushes all updates to the live site.

Write-Host "Syncing app.html changes into index.html..." -ForegroundColor Cyan

# 1. Ensure image paths in app.html are correct for its folder
(Get-Content pages/app.html) -replace 'src="icons/icon', 'src="../icons/icon' | Set-Content pages/app.html

# 2. Clone app.html into index.html but dynamically fix the relative paths!
(Get-Content pages/app.html) -replace '=\"\.\./', '="' -replace "='../", "='" | Set-Content index.html

Write-Host "Sync Complete! Deploying to GitHub..." -ForegroundColor Cyan

# 3. Add all file changes to Git
git add .

# 4. Commit them with a descriptive message
git commit -m "feat: integrate AI-Blaze assistant to dashboard"

# 5. Push to GitHub (This automatically triggers Vercel and GitHub pages)
git push

Write-Host "Deployment Successful! The live URL will update in ~60 seconds." -ForegroundColor Green
