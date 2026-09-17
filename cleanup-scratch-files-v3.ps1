# One-shot cleanup for the manual zh-cn image-backfill scratch files that
# pile up in the repo root every round. Pattern-based (not a hardcoded
# per-set list) so it catches every round's leftovers without needing to
# be edited again.
#
# v3 fix (2026-08-27): v2's *_image_urls.txt pattern didn't match this
# round's actual filenames -- the download scripts wrote plain
# "<set>_urls.txt" (no "image" in the name), so v2 would report a clean
# run while leaving all 23 of them behind. Confirmed against the real
# untracked-file list from `git status` before writing this fix, not
# guessed.
#
# Removes only:
#   - *_urls.txt                   (saved raw URL lists -- matches both
#                                    "<set>_urls.txt" and the older
#                                    "<set>_image_urls.txt" naming, since
#                                    *_urls.txt is a superset of both)
#   - download-*-by-position.ps1   (download-by-position scripts)
#   - finalize-*-images.ps1        (finalize/move scripts)
#   - *_pos_check\ folders         (download holding folders)
#
# Does NOT touch manual-cn-images\ (the real backfill source images
# already uploaded to Supabase Storage), the raw wiki-capture .txt files
# from the zh-cn booster-set research rounds (round3-raw.txt,
# sm-p-sv-p-raw.txt, happyset-round4-raw.txt, round18-raw.txt, etc. --
# those are a separate, still-optional cleanup, not part of this
# workflow), real scripts (e.g. scripts\zh-cn-round18.ts), stray .html
# files, or anything else in the repo.
#
# Safe to run repeatedly / on a partially-cleaned repo -- if nothing
# matches a given pattern, that step just does nothing.
#
# Usage: run from the repo root, e.g.:
#   cd "C:\Users\razza\Documents\Pokemon Collection"
#   powershell -ExecutionPolicy Bypass -File cleanup-scratch-files-v3.ps1
$removed = 0
Get-ChildItem -Path . -Filter "*_urls.txt" -File | ForEach-Object {
    Remove-Item -Path $_.FullName -Force
    Write-Host "Removed: $($_.Name)"
    $removed++
}
Get-ChildItem -Path . -Filter "download-*-by-position.ps1" -File | ForEach-Object {
    Remove-Item -Path $_.FullName -Force
    Write-Host "Removed: $($_.Name)"
    $removed++
}
Get-ChildItem -Path . -Filter "finalize-*-images.ps1" -File | ForEach-Object {
    Remove-Item -Path $_.FullName -Force
    Write-Host "Removed: $($_.Name)"
    $removed++
}
Get-ChildItem -Path . -Filter "*_pos_check" -Directory | ForEach-Object {
    Remove-Item -Path $_.FullName -Recurse -Force
    Write-Host "Removed: $($_.Name)\"
    $removed++
}
Write-Host ""
Write-Host "Removed $removed item(s)."
Write-Host "manual-cn-images\, card.html/cs1ac.html, scripts\zh-cn-round18.ts, and everything else were left untouched."
