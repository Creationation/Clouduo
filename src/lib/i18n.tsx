import { createContext, useContext, useState, type ReactNode } from 'react'

export type Lang = 'fr' | 'de'

// Dictionnaire simple FR/DE. FR = référence.
const dict = {
  fr: {
    'app.name': 'NuageDuo',
    'nav.gallery': 'Galerie',
    'nav.shared': 'Commun',
    'nav.upload': 'Ajouter',
    'nav.inbox': 'Reçus',
    'nav.settings': 'Réglages',
    'login.title': 'Notre cloud privé',
    'login.email': 'Email',
    'login.password': 'Mot de passe',
    'login.submit': 'Se connecter',
    'login.error': 'Email ou mot de passe incorrect',
    'login.loading': 'Connexion...',
    'gallery.mine': 'Mes fichiers',
    'gallery.empty': 'Aucun fichier pour le moment',
    'gallery.photos': 'Photos',
    'gallery.videos': 'Vidéos',
    'gallery.all': 'Tout',
    'shared.title': 'Commun',
    'shared.empty': 'Le Commun est vide',
    'upload.title': 'Ajouter des fichiers',
    'upload.drop': 'Glisse tes fichiers ici ou clique pour choisir',
    'upload.mobile': 'Photos / Vidéos',
    'upload.camera': 'Caméra',
    'upload.queue': "File d'attente",
    'upload.pause': 'Pause',
    'upload.resume': 'Reprendre',
    'upload.retry': 'Réessayer',
    'upload.done': 'Terminé',
    'upload.dedup': 'Déjà sauvegardé',
    'backup.title': 'Backup',
    'backup.cta': 'Sauvegarder ma galerie',
    'backup.select': 'Sélectionne tes photos et vidéos',
    'backup.note':
      "Une app web ne peut pas scanner ta galerie en arrière-plan. Sélectionne tes fichiers, les doublons déjà sauvegardés sont ignorés automatiquement.",
    'inbox.title': 'Reçus',
    'inbox.empty': 'Aucun transfert en attente',
    'inbox.accept': 'Accepter',
    'inbox.decline': 'Refuser',
    'inbox.from': 'De',
    'trash.title': 'Corbeille',
    'trash.empty': 'La corbeille est vide',
    'trash.restore': 'Restaurer',
    'trash.deleteForever': 'Supprimer définitivement',
    'trash.info': 'Les fichiers sont purgés automatiquement après 30 jours.',
    'settings.title': 'Réglages',
    'settings.storage': 'Stockage',
    'settings.mine': 'Moi',
    'settings.shared': 'Commun',
    'settings.total': 'Total (stockage réel)',
    'settings.trash': 'Corbeille',
    'settings.lang': 'Langue',
    'settings.logout': 'Se déconnecter',
    'settings.trashLink': 'Ouvrir la corbeille',
    'action.download': "Télécharger l'original",
    'action.rename': 'Renommer',
    'action.delete': 'Supprimer',
    'action.moveToShared': 'Mettre dans le Commun',
    'action.recover': 'Récupérer',
    'action.send': 'Envoyer à',
    'action.newFolder': 'Nouveau dossier',
    'action.cancel': 'Annuler',
    'action.confirm': 'Confirmer',
    'common.photo': 'photo',
    'common.video': 'vidéo',
    'common.file': 'fichier',
    'common.files': 'fichiers',
    'common.loading': 'Chargement...',
  },
  de: {
    'app.name': 'NuageDuo',
    'nav.gallery': 'Galerie',
    'nav.shared': 'Gemeinsam',
    'nav.upload': 'Hinzufügen',
    'nav.inbox': 'Empfang',
    'nav.settings': 'Einstellungen',
    'login.title': 'Unsere private Cloud',
    'login.email': 'E-Mail',
    'login.password': 'Passwort',
    'login.submit': 'Anmelden',
    'login.error': 'E-Mail oder Passwort falsch',
    'login.loading': 'Anmeldung...',
    'gallery.mine': 'Meine Dateien',
    'gallery.empty': 'Noch keine Dateien',
    'gallery.photos': 'Fotos',
    'gallery.videos': 'Videos',
    'gallery.all': 'Alle',
    'shared.title': 'Gemeinsam',
    'shared.empty': 'Der gemeinsame Bereich ist leer',
    'upload.title': 'Dateien hinzufügen',
    'upload.drop': 'Dateien hierher ziehen oder klicken',
    'upload.mobile': 'Fotos / Videos',
    'upload.camera': 'Kamera',
    'upload.queue': 'Warteschlange',
    'upload.pause': 'Pause',
    'upload.resume': 'Fortsetzen',
    'upload.retry': 'Erneut',
    'upload.done': 'Fertig',
    'upload.dedup': 'Bereits gesichert',
    'backup.title': 'Backup',
    'backup.cta': 'Galerie sichern',
    'backup.select': 'Fotos und Videos auswählen',
    'backup.note':
      'Eine Web-App kann deine Galerie nicht im Hintergrund scannen. Wähle deine Dateien aus, bereits gesicherte Duplikate werden automatisch übersprungen.',
    'inbox.title': 'Empfang',
    'inbox.empty': 'Keine ausstehenden Übertragungen',
    'inbox.accept': 'Annehmen',
    'inbox.decline': 'Ablehnen',
    'inbox.from': 'Von',
    'trash.title': 'Papierkorb',
    'trash.empty': 'Der Papierkorb ist leer',
    'trash.restore': 'Wiederherstellen',
    'trash.deleteForever': 'Endgültig löschen',
    'trash.info': 'Dateien werden nach 30 Tagen automatisch gelöscht.',
    'settings.title': 'Einstellungen',
    'settings.storage': 'Speicher',
    'settings.mine': 'Ich',
    'settings.shared': 'Gemeinsam',
    'settings.total': 'Gesamt (realer Speicher)',
    'settings.trash': 'Papierkorb',
    'settings.lang': 'Sprache',
    'settings.logout': 'Abmelden',
    'settings.trashLink': 'Papierkorb öffnen',
    'action.download': 'Original herunterladen',
    'action.rename': 'Umbenennen',
    'action.delete': 'Löschen',
    'action.moveToShared': 'In Gemeinsam legen',
    'action.recover': 'Übernehmen',
    'action.send': 'Senden an',
    'action.newFolder': 'Neuer Ordner',
    'action.cancel': 'Abbrechen',
    'action.confirm': 'Bestätigen',
    'common.photo': 'Foto',
    'common.video': 'Video',
    'common.file': 'Datei',
    'common.files': 'Dateien',
    'common.loading': 'Laden...',
  },
} as const

export type TKey = keyof (typeof dict)['fr']

const I18nContext = createContext<{
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: TKey) => string
}>({ lang: 'fr', setLang: () => {}, t: (k) => k })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem('lang') as Lang) || 'fr',
  )
  const setLang = (l: Lang) => {
    localStorage.setItem('lang', l)
    setLangState(l)
  }
  const t = (k: TKey) => dict[lang][k] ?? dict.fr[k] ?? k
  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  return useContext(I18nContext)
}
