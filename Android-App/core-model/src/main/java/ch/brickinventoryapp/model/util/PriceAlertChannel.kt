package ch.brickinventoryapp.model.util

/**
 * The notification channel of the price alerts. Android keeps the user's channel settings
 * under this id, so it stays as first released; the worker posts to it, settings reads it.
 */
const val PRICE_ALERT_CHANNEL = "preisalarm"
