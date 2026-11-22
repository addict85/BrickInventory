package ch.brickinventoryapp.model.util

/**
 * Name and code of the running app version. Only the app module knows its
 * BuildConfig; the areas get the values via Hilt (ViewModels) and
 * LocalAppVersion (UI).
 */

data class AppVersion(val name: String, val code: Int)
