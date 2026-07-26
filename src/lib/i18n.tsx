import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { Lang } from './types'

export type { Lang }

// Dictionnaire simple FR/DE. FR = référence.
const dict = {
  fr: {
    'app.name': 'Clouduo',
    'nav.gallery': 'Galerie',
    'nav.shared': 'Commun',
    'nav.upload': 'Ajouter',
    'nav.inbox': 'Reçus',
    'nav.settings': 'Réglages',
    'nav.menu': 'Menu',
    'nav.docs': 'Documents',
    'nav.sharedDocs': 'Documents communs',
    'docs.title': 'Mes documents',
    'docs.shared': 'Documents communs',
    'docs.empty': 'Aucun document',
    'sort.newest': 'Récents d’abord',
    'sort.oldest': 'Anciens d’abord',
    'select.count': 'sélectionné(s)',
    'action.move': 'Déplacer',
    'move.title': 'Déplacer vers',
    'move.root': 'Racine',
    'login.title': 'Notre cloud privé',
    'login.email': 'Email',
    'login.username': "Nom d'utilisateur ou email",
    'login.password': 'Mot de passe',
    'login.submit': 'Se connecter',
    'login.error': "Nom d'utilisateur ou mot de passe incorrect",
    'login.loading': 'Connexion...',
    'login.tooMany': 'Trop de tentatives. Réessaie dans 15 minutes.',
    'login.forgot': 'Mot de passe oublié ?',
    'login.linkExpired':
      'Ce lien de réinitialisation a expiré ou a déjà servi. Demandes-en un nouveau.',
    'login.forgotHint':
      "Entre ton nom d'utilisateur ou ton email : un lien de réinitialisation part sur l'email du compte.",
    'login.forgotSend': 'Envoyer le lien',
    'login.forgotSent': 'Si le compte existe, le lien vient de partir.',
    'login.backToLogin': 'Retour à la connexion',
    'pwd.title': 'Mot de passe',
    'pwd.change': 'Changer le mot de passe',
    'pwd.newTitle': 'Nouveau mot de passe',
    'pwd.new': 'Nouveau mot de passe',
    'pwd.confirm': 'Confirmer le mot de passe',
    'pwd.rule': 'Au moins 8 caractères.',
    'pwd.tooShort': 'Le mot de passe doit faire au moins 8 caractères.',
    'pwd.mismatch': 'Les deux mots de passe ne correspondent pas.',
    'pwd.save': 'Enregistrer',
    'pwd.changed': 'Mot de passe modifié',
    'gallery.mine': 'Mes fichiers',
    'gallery.empty': 'Aucun fichier pour le moment',
    'gallery.photos': 'Photos',
    'gallery.videos': 'Vidéos',
    'gallery.all': 'Tout',
    'shared.title': 'Commun',
    'shared.empty': 'Le Commun est vide',
    'shared.media': 'Photos & vidéos',
    'inbox.accepted': 'Ajouté à Mes fichiers',
    'upload.title': 'Ajouter des fichiers',
    'upload.drop': 'Glisse tes fichiers ou tes dossiers ici',
    'upload.dropHint': 'Les sous-dossiers sont parcourus, seules les photos et vidéos sont prises',
    'upload.mobile': 'Photos / Vidéos',
    'upload.camera': 'Caméra',
    'upload.folder': 'Choisir un dossier',
    'upload.scanning': 'Lecture du dossier...',
    'upload.added': 'fichiers ajoutés',
    'upload.none': 'Aucune photo ni vidéo trouvée',
    'upload.dest': 'Destination',
    'upload.note': 'Petit mot (optionnel)',
    'upload.sendHint': 'Le fichier reste chez toi et part en attente chez',
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
    'dup.title': 'Doublons',
    'dup.intro':
      "Fichiers identiques détectés par leur empreinte, quel que soit leur nom ou leur type.",
    'dup.none': 'Aucun doublon, tout est propre',
    'dup.groups': 'Groupes de doublons',
    'dup.recoverable': 'Espace récupérable',
    'dup.copies': 'exemplaires',
    'dup.wasted': 'en trop',
    'dup.sameObject': 'même fichier stocké, aucun espace perdu',
    'dup.keepOne': 'Garder le plus ancien',
    'dup.movedToTrash': 'exemplaires mis à la corbeille',
    'dup.note':
      "Rien n'est supprimé définitivement : les exemplaires partent à la corbeille, purgée après 30 jours.",
    'quota.full': 'Plus assez de place pour cet envoi.',
    'quota.near': 'Attention, le stockage arrive à saturation.',
    'settings.quota': 'Plafond',
    'settings.lang': 'Langue',
    'settings.theme': 'Apparence',
    'theme.light': 'Clair',
    'theme.dark': 'Sombre',
    'settings.logout': 'Se déconnecter',
    'settings.trashLink': 'Ouvrir la corbeille',
    'action.download': "Télécharger l'original",
    'action.rename': 'Renommer',
    'action.edit': 'Renommer / changer la date',
    'edit.title': 'Nom et date',
    'edit.name': 'Nom du fichier',
    'edit.date': 'Date du souvenir',
    'edit.dateHint':
      "Commande le classement dans la galerie. L'original n'est pas modifié.",
    'edit.badDate': 'Date invalide',
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
    'app.name': 'Clouduo',
    'nav.gallery': 'Galerie',
    'nav.shared': 'Gemeinsam',
    'nav.upload': 'Hinzufügen',
    'nav.inbox': 'Empfang',
    'nav.settings': 'Einstellungen',
    'nav.menu': 'Menü',
    'nav.docs': 'Dokumente',
    'nav.sharedDocs': 'Gemeinsame Dokumente',
    'docs.title': 'Meine Dokumente',
    'docs.shared': 'Gemeinsame Dokumente',
    'docs.empty': 'Keine Dokumente',
    'sort.newest': 'Neueste zuerst',
    'sort.oldest': 'Älteste zuerst',
    'select.count': 'ausgewählt',
    'action.move': 'Verschieben',
    'move.title': 'Verschieben nach',
    'move.root': 'Hauptordner',
    'login.title': 'Unsere private Cloud',
    'login.email': 'E-Mail',
    'login.username': 'Benutzername oder E-Mail',
    'login.password': 'Passwort',
    'login.submit': 'Anmelden',
    'login.error': 'Benutzername oder Passwort falsch',
    'login.loading': 'Anmeldung...',
    'login.tooMany': 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.',
    'login.forgot': 'Passwort vergessen?',
    'login.linkExpired':
      'Dieser Link ist abgelaufen oder wurde bereits verwendet. Bitte einen neuen anfordern.',
    'login.forgotHint':
      'Gib deinen Benutzernamen oder deine E-Mail ein: Der Link geht an die E-Mail des Kontos.',
    'login.forgotSend': 'Link senden',
    'login.forgotSent': 'Falls das Konto existiert, wurde der Link gesendet.',
    'login.backToLogin': 'Zurück zur Anmeldung',
    'pwd.title': 'Passwort',
    'pwd.change': 'Passwort ändern',
    'pwd.newTitle': 'Neues Passwort',
    'pwd.new': 'Neues Passwort',
    'pwd.confirm': 'Passwort bestätigen',
    'pwd.rule': 'Mindestens 8 Zeichen.',
    'pwd.tooShort': 'Das Passwort muss mindestens 8 Zeichen haben.',
    'pwd.mismatch': 'Die Passwörter stimmen nicht überein.',
    'pwd.save': 'Speichern',
    'pwd.changed': 'Passwort geändert',
    'gallery.mine': 'Meine Dateien',
    'gallery.empty': 'Noch keine Dateien',
    'gallery.photos': 'Fotos',
    'gallery.videos': 'Videos',
    'gallery.all': 'Alle',
    'shared.title': 'Gemeinsam',
    'shared.empty': 'Der gemeinsame Bereich ist leer',
    'shared.media': 'Fotos & Videos',
    'inbox.accepted': 'Zu Meine Dateien hinzugefügt',
    'upload.title': 'Dateien hinzufügen',
    'upload.drop': 'Dateien oder Ordner hierher ziehen',
    'upload.dropHint': 'Unterordner werden durchsucht, nur Fotos und Videos werden übernommen',
    'upload.mobile': 'Fotos / Videos',
    'upload.camera': 'Kamera',
    'upload.folder': 'Ordner wählen',
    'upload.scanning': 'Ordner wird gelesen...',
    'upload.added': 'Dateien hinzugefügt',
    'upload.none': 'Keine Fotos oder Videos gefunden',
    'upload.dest': 'Ziel',
    'upload.note': 'Kurze Nachricht (optional)',
    'upload.sendHint': 'Die Datei bleibt bei dir und wartet bei',
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
    'dup.title': 'Duplikate',
    'dup.intro':
      'Identische Dateien, erkannt am Prüfsummen-Fingerabdruck, unabhängig von Name und Typ.',
    'dup.none': 'Keine Duplikate, alles sauber',
    'dup.groups': 'Duplikat-Gruppen',
    'dup.recoverable': 'Freigebbarer Speicher',
    'dup.copies': 'Kopien',
    'dup.wasted': 'zu viel',
    'dup.sameObject': 'dieselbe gespeicherte Datei, kein Speicherverlust',
    'dup.keepOne': 'Älteste behalten',
    'dup.movedToTrash': 'Kopien in den Papierkorb verschoben',
    'dup.note':
      'Nichts wird endgültig gelöscht: Die Kopien landen im Papierkorb und werden nach 30 Tagen entfernt.',
    'quota.full': 'Nicht genug Speicherplatz für diesen Upload.',
    'quota.near': 'Achtung, der Speicher ist fast voll.',
    'settings.quota': 'Limit',
    'settings.lang': 'Sprache',
    'settings.theme': 'Erscheinungsbild',
    'theme.light': 'Hell',
    'theme.dark': 'Dunkel',
    'settings.logout': 'Abmelden',
    'settings.trashLink': 'Papierkorb öffnen',
    'action.download': 'Original herunterladen',
    'action.rename': 'Umbenennen',
    'action.edit': 'Umbenennen / Datum ändern',
    'edit.title': 'Name und Datum',
    'edit.name': 'Dateiname',
    'edit.date': 'Datum der Erinnerung',
    'edit.dateHint':
      'Bestimmt die Sortierung in der Galerie. Das Original bleibt unverändert.',
    'edit.badDate': 'Ungültiges Datum',
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
  const { session, profile, refreshProfiles } = useAuth()
  // Avant connexion: choix fait sur l'écran d'accueil, gardé localement.
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem('lang') as Lang) || 'fr',
  )

  // Une fois connecté, la langue du COMPTE fait foi: on la retrouve sur
  // n'importe quel appareil, quel que soit le navigateur utilisé.
  useEffect(() => {
    if (profile?.lang && profile.lang !== lang) {
      setLangState(profile.lang)
      localStorage.setItem('lang', profile.lang)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.lang])

  const setLang = async (l: Lang) => {
    localStorage.setItem('lang', l)
    setLangState(l)
    if (session) {
      await supabase.from('profiles').update({ lang: l }).eq('id', session.user.id)
      await refreshProfiles()
    }
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
