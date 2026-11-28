package ch.brickinventoryapp.uistate

/**
 * What a loading error stands for, coarse enough for icon, heading and advice: whoever is
 * offline shall check the network, whoever was signed out shall sign in. A raw sentence like
 * „Serverfehler (500)“ alone said neither the one nor the other.
 */

enum class ErrorClass { OFFLINE, SERVER, LOGIN, UNKNOWN }
