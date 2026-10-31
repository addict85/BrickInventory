package ch.brickinventoryapp.ui.viewmodel

import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel

/**
 * Ein ViewModel, das der ganzen Activity gehört — dieselbe Instanz in jedem
 * Bildschirm, ohne sie durch alle Ebenen zu reichen. Für Zustand, der nicht an
 * einem Ziel hängt (Selbstaktualisierung).
 */
@Composable
inline fun <reified T : ViewModel> aktivitaetsViewModel(): T =
    hiltViewModel(checkNotNull(LocalActivity.current as? ComponentActivity) { "keine ComponentActivity" })
