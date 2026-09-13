import { handle } from './wrapper'
import { activateLicense, clearLicense, getLicenseStatus } from '../services/licenseService'

handle('license:status', () => getLicenseStatus())
handle('license:activate', (code: string) => activateLicense(code))
handle('license:deactivate', () => clearLicense())
