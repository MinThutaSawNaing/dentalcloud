import React, { useState, useEffect, useRef } from 'react';
import { Home, Calendar, FileText, User, LogOut, Plus, Trash2, Download, Eye, EyeOff, MessageCircle, X, Info, FolderOpen } from 'lucide-react';
import PatientQRCode from './PatientQRCode';
import { auth } from '../services/auth';
import { api } from '../services/api';
import { otpService } from '../services/otp';
import { BranchReceiptIdentity, Patient, Appointment, ClinicalRecord, Doctor, PatientFile, ReceiptSize } from '../types';
import { Modal, Input, TimeInput } from './Shared';
import { SearchableSelect } from './SearchableSelect';
import Receipt from './Receipt';
import PatientMessagingView from './PatientMessagingView';
import { compareAppointmentStatus } from '../utils/appointmentSorting';
import { formatTeethWithPosition } from '../utils/toothNumbering';
import { formatDoctorName } from '../utils/doctorName';

interface PatientDashboardProps {
  onLogout: () => void | Promise<void>;
  messagingEnabled?: boolean;
  hoverTheme: 'blue' | 'green' | 'yellow' | 'brown' | 'dark';
}

const PatientDashboard: React.FC<PatientDashboardProps> = ({ onLogout, messagingEnabled = true, hoverTheme }) => {
  const [activeTab, setActiveTab] = useState<'home' | 'appointments' | 'records' | 'profile' | 'messages'>('home');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [treatmentRecords, setTreatmentRecords] = useState<ClinicalRecord[]>([]);
  const [patientFiles, setPatientFiles] = useState<PatientFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // State for document viewer
  const [showDocumentViewer, setShowDocumentViewer] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<PatientFile | null>(null);
  
  // State for appointment management
  const [showCreateAppointment, setShowCreateAppointment] = useState(false);
  const [newAppointment, setNewAppointment] = useState({
    date: '',
    time: '',
    type: '',
    status: 'Scheduled',
    notes: ''
  });
  
  // State for doctor selection and available times
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [treatmentTypeOptions, setTreatmentTypeOptions] = useState<string[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<string>('');
  
  // State for searchable doctor dropdown
  const [doctorSearchQuery, setDoctorSearchQuery] = useState('');
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const doctorDropdownRef = useRef<HTMLDivElement>(null);
  
  // Filter doctors based on search query
  const filteredDoctors = doctors.filter(doctor => {
    if (!doctorSearchQuery.trim()) return true;
    const query = doctorSearchQuery.toLowerCase();
    const name = doctor.name.toLowerCase();
    const spec = doctor.specialization?.toLowerCase() || '';
    return name.startsWith(query) || spec.startsWith(query);
  });
  
  // State for profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileChanges, setProfileChanges] = useState({
    name: '',
    email: '',
    phone: ''
  });
  
  // State for treatment details modal
  const [showTreatmentDetails, setShowTreatmentDetails] = useState(false);
  const [selectedTreatmentDetails, setSelectedTreatmentDetails] = useState<ClinicalRecord | null>(null);
  
  // State for password change
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChange, setPasswordChange] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  
  // State for receipts
  const [showReceipt, setShowReceipt] = useState(false);
  const [selectedTreatment, setSelectedTreatment] = useState<ClinicalRecord | null>(null);
  const [receiptSize, setReceiptSize] = useState<ReceiptSize>('A4');
  const [currency, setCurrency] = useState<'USD' | 'MMK'>('USD');
  const [appName, setAppName] = useState('DentalCloud Pro');
  const [receiptIdentity, setReceiptIdentity] = useState<BranchReceiptIdentity | null>(null);
  const sortedAppointments = appointments.slice().sort((a, b) =>
    compareAppointmentStatus(a, b) || a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
  );
  
  // State for showing/hiding passwords
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });
  
  // State for cancellation
  const [cancellingAppointment, setCancellingAppointment] = useState<string | null>(null);
  
  useEffect(() => {
    fetchPatientData();
  }, []);

  const fetchPatientData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const patientId = auth.getCurrentPatientId();
      if (!patientId) {
        throw new Error('No patient session found');
      }

      const sessionLocationId = auth.getCurrentUser()?.location_id || undefined;
      
      // Fetch patient profile
      const allPatients = await api.patients.getAll(sessionLocationId);
      const patientData = allPatients.find(p => p.id === patientId);
      if (!patientData) {
        throw new Error('Patient data not found');
      }
      setPatient(patientData);

      // Receipt configuration is supplementary. Migration/network failures must
      // never prevent the patient's clinical data from loading.
      const receiptConfigurationResults = await Promise.allSettled([
        api.appSettings.getReceiptPreferences().then((preferences) => {
          if (!preferences) return;
          setReceiptSize(preferences.receiptSize);
          setCurrency(preferences.currency);
        }),
        api.appSettings.getAppName().then((name) => {
          if (name?.trim()) setAppName(name.trim());
        }),
        api.branchReceiptIdentity.get(patientData.location_id).then(setReceiptIdentity)
      ]);
      receiptConfigurationResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(['receipt preferences', 'application name', 'branch receipt identity'][index] + ' unavailable in patient portal:', result.reason);
        }
      });
      
      // Initialize profile changes with current values
      setProfileChanges({
        name: patientData.name,
        email: patientData.email,
        phone: patientData.phone || ''
      });
      
      // Fetch appointments
      const allAppointments = await api.appointments.getAll(patientData.location_id);
      const patientAppointments = allAppointments.filter(apt => apt.patient_id === patientId);
      setAppointments(patientAppointments);
      
      // Fetch treatment records
      const records = await api.treatments.getHistory(patientId);
      setTreatmentRecords(records);

      // Fetch patient files
      try {
        const files = await api.files.list(patientId);
        setPatientFiles(files);
      } catch (fileErr) {
        console.error('Failed to fetch patient files:', fileErr);
        // Don't fail the entire fetch if files fail
        setPatientFiles([]);
      }

      // Fetch doctors
      const allDoctors = await api.doctors.getAll(patientData.location_id);
      setDoctors(allDoctors);

      // Fetch treatment types for appointment reason/type
      const allTreatmentTypes = await api.treatments.getTypes(patientData.location_id);
      const typeNames = [...new Set(allTreatmentTypes.map((type) => (type.name || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      setTreatmentTypeOptions(typeNames);
      
    } catch (err: any) {
      setError(err.message || 'Failed to load patient data');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    auth.logout();
    onLogout();
  };

  const handleLoginAgain = async () => {
    setError(null);
    setPatient(null);
    await onLogout();
  };

  const openCreateAppointmentModal = () => {
    setNewAppointment((prev) => ({
      ...prev,
      type: prev.type || treatmentTypeOptions[0] || ''
    }));
    setShowCreateAppointment(true);
  };
  
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient) return;
    
    try {
      await api.appointments.create({
        patient_id: patient.id,
        doctor_id: selectedDoctor || undefined,
        date: newAppointment.date,
        time: newAppointment.time,
        type: newAppointment.type,
        status: newAppointment.status as 'Scheduled' | 'Completed' | 'Cancelled',
        notes: newAppointment.notes,
        location_id: patient.location_id
      });
      
      setShowCreateAppointment(false);
      setNewAppointment({
        date: '',
        time: '',
        type: treatmentTypeOptions[0] || '',
        status: 'Scheduled',
        notes: ''
      });
      setSelectedDoctor('');
      
      // Refresh appointments
      fetchPatientData();
    } catch (err: any) {
      setError(err.message || 'Failed to create appointment');
    }
  };
  
  const handleCancelAppointment = async (appointmentId: string) => {
    try {
      await api.appointments.delete(appointmentId);
      
      // Refresh appointments
      fetchPatientData();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel appointment');
    }
  };
  
  const handleUpdateProfile = async () => {
    if (!patient) return;
    
    try {
      const updatedPatient = await api.patients.update(patient.id, {
        name: profileChanges.name,
        email: profileChanges.email,
        phone: profileChanges.phone
      });
      
      setPatient(updatedPatient);
      setEditingProfile(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
    }
  };
  
  const handleChangePassword = async () => {
    if (!patient) return;
    
    if (passwordChange.newPassword !== passwordChange.confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (passwordChange.newPassword.trim().length < 6) {
      setError('New password must be at least 6 characters long');
      return;
    }
    
    try {
      // First authenticate with current password
      const authenticated = await api.patients.authenticate(
        patient.email || patient.phone || patient.name, 
        passwordChange.currentPassword
      );
      
      if (!authenticated) {
        setError('Current password is incorrect');
        return;
      }

      const nextPassword = passwordChange.newPassword.trim();
      const supabaseUser = await otpService.getCurrentUser();
      const canSyncSupabase =
        !!supabaseUser &&
        !!supabaseUser.email &&
        !!patient.email &&
        supabaseUser.email.toLowerCase() === patient.email.toLowerCase();

      if (canSyncSupabase) {
        const updateResult = await otpService.updatePassword(nextPassword);
        if (!updateResult.success) {
          throw new Error(updateResult.message || 'Failed to update Supabase password');
        }

        await api.patients.updatePasswordByEmail(
          supabaseUser.email!,
          nextPassword,
          supabaseUser.id
        );
      } else {
        // Legacy-only patient accounts still rely on the local patient_auth password.
        await api.patients.updateAccount(
          patient.id,
          patient.email || null,
          nextPassword,
          patient.phone || null
        );
      }
      
      // Reset password change form
      setChangingPassword(false);
      setPasswordChange({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
    }
  };
  
  const handleDownloadReceipt = (treatment: ClinicalRecord) => {
    setSelectedTreatmentDetails(treatment);
    setShowTreatmentDetails(true);
  };
  
  const handleDoctorChange = (doctorId: string) => {
    setSelectedDoctor(doctorId);
  };

  const handleDateChange = (date: string) => {
    setNewAppointment({...newAppointment, date});
  };
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--hover-200)] border-t-[var(--hover-600)] rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (error && !patient) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-md text-center">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Error Loading Dashboard</h3>
          <p className="text-xs text-gray-500 mb-4">{error}</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={fetchPatientData}
              className="bg-[var(--hover-600)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--hover-700)] transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={handleLoginAgain}
              className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Login Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Patient data not available</p>
      </div>
    );
  }

  const today = new Date();
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const nextScheduledAppointment = appointments
    .filter((apt) => apt.status === 'Scheduled')
    .filter((apt) => {
      const aptDate = new Date(`${apt.date}T00:00:00`);
      return aptDate >= todayDateOnly;
    })
    .sort((a, b) => {
      const aDate = new Date(`${a.date}T${a.time || '00:00'}:00`).getTime();
      const bDate = new Date(`${b.date}T${b.time || '00:00'}:00`).getTime();
      return aDate - bDate;
    })[0];

  const daysLeft = nextScheduledAppointment
    ? Math.ceil(
        (new Date(`${nextScheduledAppointment.date}T00:00:00`).getTime() - todayDateOnly.getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  // Helper function to format bytes
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Handle document view
  const handleViewDocument = (file: PatientFile) => {
    setSelectedDocument(file);
    setShowDocumentViewer(true);
  };

  // Handle document download
  const handleDownloadDocument = (file: PatientFile) => {
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-gray-900">{patient.name}</h1>
            <p className="text-xs text-gray-400">Patient Portal</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('profile')}
              className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-gray-50 transition-colors"
              aria-label="Profile settings"
              title="Profile"
            >
              <User className="w-4.5 h-4.5 text-gray-500" />
            </button>
            <button
              onClick={handleLogout}
              className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-gray-50 transition-colors"
              aria-label="Log out of your account"
              title="Logout"
            >
              <LogOut className="w-4.5 h-4.5 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={activeTab === 'messages' ? 'h-[calc(100dvh-9rem)] min-h-0 overflow-hidden' : 'flex-1 overflow-y-auto pb-28 pt-4'}>
        {error && patient && (
          <div className="px-4 mb-3">
            <div className="bg-red-50 border border-red-100 rounded-lg p-3 flex items-start justify-between gap-3">
              <p className="text-xs text-red-600">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'home' && (
          <div className="px-4 pb-6 space-y-4">
            {/* Next Appointment */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Next Appointment</p>
                <Calendar className="w-4 h-4 text-gray-300" />
              </div>
              {nextScheduledAppointment ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-[var(--hover-600)]">{daysLeft ?? '--'}</span>
                    <span className="text-sm text-[var(--hover-500)]">{daysLeft === 1 ? 'day' : 'days'}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {nextScheduledAppointment.date} at {nextScheduledAppointment.time}
                  </p>
                  {nextScheduledAppointment.type && (
                    <span className="inline-block mt-2 bg-[var(--hover-100)] text-[var(--hover-700)] rounded px-2 py-0.5 text-xs font-medium">
                      {nextScheduledAppointment.type}
                    </span>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-400">No upcoming appointments</p>
              )}
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xl font-bold text-[var(--hover-600)]">{appointments.length}</p>
                <p className="text-xs text-gray-400 mt-0.5">Appointments</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xl font-bold text-[var(--hover-600)]">{treatmentRecords.length}</p>
                <p className="text-xs text-gray-400 mt-0.5">Treatments</p>
              </div>
            </div>

            {/* Upcoming Appointments */}
            <div className="bg-white rounded-xl border border-gray-100">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">Upcoming Appointments</h2>
                <button
                  onClick={() => setActiveTab('appointments')}
                  className="text-xs font-medium text-[var(--hover-600)] hover:text-[var(--hover-700)] transition-colors"
                >
                  View All
                </button>
              </div>
              <div className="p-3">
                {appointments.filter(apt => apt.status === 'Scheduled').length > 0 ? (
                  <div className="space-y-1">
                    {appointments
                      .filter(apt => apt.status === 'Scheduled')
                      .slice(0, 3)
                      .map(apt => (
                        <div key={apt.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[var(--hover-50)] transition-colors">
                          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--hover-50)] flex-shrink-0">
                            <Calendar className="w-4 h-4 text-[var(--hover-500)]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{apt.date}</p>
                            <p className="text-xs text-gray-400 truncate">{apt.time} � {apt.type}</p>
                          </div>
                          <span className="px-2 py-0.5 text-xs rounded bg-[var(--hover-50)] text-[var(--hover-600)] font-medium flex-shrink-0">
                            {apt.status}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-6 text-center">
                    <Calendar className="w-8 h-8 text-gray-200" />
                    <p className="text-xs text-gray-400 mt-2">No upcoming appointments</p>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Treatments */}
            <div className="bg-white rounded-xl border border-gray-100">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">Recent Treatments</h2>
                <button
                  onClick={() => setActiveTab('records')}
                  className="text-xs font-medium text-[var(--hover-600)] hover:text-[var(--hover-700)] transition-colors"
                >
                  View All
                </button>
              </div>
              <div className="p-3">
                {treatmentRecords.length > 0 ? (
                  <div className="space-y-1">
                    {treatmentRecords
                      .slice(0, 3)
                      .map(record => (
                        <div key={record.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[var(--hover-50)] transition-colors">
                          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--hover-50)] flex-shrink-0">
                            <FileText className="w-4 h-4 text-[var(--hover-500)]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{record.description}</p>
                            <p className="text-xs text-gray-400 truncate">{record.date}</p>
                          </div>
                          <button
                            onClick={() => handleDownloadReceipt(record)}
                            className="text-xs font-medium text-[var(--hover-600)] hover:text-[var(--hover-700)] transition-colors flex-shrink-0"
                          >
                            Details
                          </button>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-6 text-center">
                    <FileText className="w-8 h-8 text-gray-200" />
                    <p className="text-xs text-gray-400 mt-2">No treatment records yet</p>
                  </div>
                )}
              </div>
            </div>

            {/* Book Appointment */}
            <button
              onClick={() => openCreateAppointmentModal()}
              className="w-full bg-[var(--hover-600)] text-white rounded-xl px-5 py-3.5 flex items-center justify-between hover:bg-[var(--hover-700)] transition-colors"
            >
              <div className="text-left">
                <p className="text-sm font-semibold">Book Your Next Visit</p>
                <p className="text-xs text-white/60 mt-0.5">Schedule an appointment today</p>
              </div>
              <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        )}

        {activeTab === 'appointments' && (
          <div className="px-4">
            <div className="bg-white rounded-xl shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-sm font-semibold text-gray-900">My Appointments</h2>
                <button
                  onClick={() => openCreateAppointmentModal()}
                  className="h-10 flex items-center gap-1.5 bg-[var(--hover-600)] text-white px-4 rounded-lg hover:brightness-110 transition-all text-xs font-semibold"
                >
                  <Plus className="w-4 h-4" />
                  New
                </button>
              </div>
              <div className="p-4">
                {appointments.length > 0 ? (
                  <div className="space-y-3">
                    {sortedAppointments.map(apt => (
                      <div key={apt.id} className="p-4 border border-gray-200 rounded-xl">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="text-sm font-medium text-gray-900">{apt.type}</h3>
                          <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                            apt.status === 'Scheduled' ? 'bg-gray-100 text-gray-700' :
                            apt.status === 'Completed' ? 'bg-green-50 text-green-700' :
                            'bg-red-50 text-red-700'
                          }`}>
                            {apt.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mb-1">
                          <Calendar className="w-3 h-3 inline mr-1" />
                          {apt.date} at {apt.time}
                        </p>
                        {apt.doctor_name && (
                          <p className="text-xs text-gray-500 mb-2">
                            <User className="w-3 h-3 inline mr-1" />
                            {formatDoctorName(apt.doctor_name)}
                          </p>
                        )}
                        {apt.notes && (
                          <p className="text-xs text-gray-400 mt-2 truncate">{apt.notes}</p>
                        )}
                        {apt.status === 'Scheduled' && (
                          <div className="mt-3 flex justify-end">
                            <button
                              onClick={() => {
                                if (window.confirm('Are you sure you want to cancel this appointment?')) {
                                  handleCancelAppointment(apt.id);
                                }
                              }}
                              className="h-9 px-3 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3 h-3 inline mr-1" />
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <h3 className="text-sm font-medium text-gray-900 mb-2">No Appointments</h3>
                    <p className="text-sm text-gray-500">You don't have any appointments scheduled.</p>
                    <button
                      onClick={() => openCreateAppointmentModal()}
                      className="mt-3 h-10 px-4 bg-[var(--hover-600)] text-white rounded-lg hover:brightness-110 transition-all text-xs font-semibold"
                    >
                      Schedule Appointment
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'records' && (
          <div className="px-4">
            <div className="bg-white rounded-xl shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">Treatment Records</h2>
              </div>
              <div className="p-4">
                {treatmentRecords.length > 0 ? (
                  <div className="space-y-3">
                    {treatmentRecords.map(record => (
                      <div key={record.id} className="p-4 border border-gray-200 rounded-xl">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="text-sm font-medium text-gray-900">{record.description}</h3>
                          <button
                            onClick={() => handleDownloadReceipt(record)}
                            className="h-9 px-3 text-xs font-medium text-[var(--hover-600)] hover:bg-gray-50 rounded-lg transition-colors"
                          >
                            Details
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">
                          <FileText className="w-3 h-3 inline mr-1" />
                          Date: {record.date}
                        </p>
                        {record.teeth && record.teeth.length > 0 && (
                          <p className="text-xs text-gray-400 mb-2">
                            Teeth: {formatTeethWithPosition(record.teeth)}
                          </p>
                        )}
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <span className="text-sm font-bold text-[var(--hover-600)]">
                            {record.cost.toLocaleString()} MMK
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <h3 className="text-sm font-medium text-gray-900 mb-2">No Treatment Records</h3>
                    <p className="text-sm text-gray-500">You don't have any treatment records yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="px-4 space-y-4">
            {/* Profile Information Card */}
            <div className="bg-white rounded-xl shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-sm font-semibold text-gray-900">My Profile</h2>
                <div className="flex items-center gap-2">
                  <span className="theme-accent-soft-bg theme-accent-text rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap">
                    {hoverTheme}
                  </span>
                  <button
                    onClick={() => setEditingProfile(true)}
                    className="h-10 px-4 bg-[var(--hover-600)] text-white rounded-lg hover:brightness-110 transition-all text-xs font-semibold"
                  >
                    Edit
                  </button>
                </div>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
                    <User className="w-7 h-7 text-gray-500" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">{patient.name}</h3>
                    <p className="text-xs text-gray-500">ID: {(() => {
                      const pid = patient.patient_unique_id || patient.id;
                      if (pid.length <= 5) return pid;
                      return <>{pid.substring(0, 5)}... <span className="text-indigo-500 hover:underline cursor-pointer" onClick={() => alert(pid)}>see more</span></>;
                    })()}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">Email</p>
                    <p className="text-sm font-medium text-gray-900">{patient.email}</p>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">Phone</p>
                    <p className="text-sm font-medium text-gray-900">{patient.phone || 'Not provided'}</p>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">Debt</p>
                    <p className="text-sm font-medium text-gray-900">{patient.balance.toLocaleString()} MMK</p>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">Loyalty Points</p>
                    <p className="text-sm font-medium text-gray-900">{patient.loyalty_points} points</p>
                  </div>
                </div>

                {patient.medicalHistory && (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">Medical History</p>
                    <p className="text-sm text-gray-900">{patient.medicalHistory}</p>
                  </div>
                )}

                <div className="pt-4 border-t border-gray-100">
                  <button
                    onClick={() => setChangingPassword(true)}
                    className="w-full h-10 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                  >
                    Change Password
                  </button>
                </div>
              </div>
            </div>

            {/* Patient QR Code Card */}
            <div className="bg-white rounded-xl shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">My QR Code</h2>
                <p className="text-xs text-gray-500 mt-0.5">Show this to the clinic staff for quick check-in</p>
              </div>
              <div className="p-4 flex justify-center">
                <PatientQRCode
                  patientUniqueId={patient.patient_unique_id || patient.id}
                  size={160}
                  title="SCAN ME"
                />
              </div>
            </div>


            {/* Patient Documents Card */}
            <div className="bg-white rounded-xl shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-gray-500" />
                  <h2 className="text-sm font-semibold text-gray-900">My Documents</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">View and download your medical documents</p>
              </div>
              <div className="p-4">
                {patientFiles.length === 0 ? (
                  <div className="text-center py-8">
                    <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <h3 className="text-sm font-medium text-gray-900 mb-2">No Documents Available</h3>
                    <p className="text-sm text-gray-500">Your doctor will upload documents during your visits.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {patientFiles.map((file) => (
                      <div key={file.path} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:border-gray-200 transition-all">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                            <p className="text-xs text-gray-400">{file.type || 'File'} &middot; {formatBytes(file.size)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleViewDocument(file)}
                            className="h-9 px-3 text-xs font-semibold text-[var(--hover-600)] bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-1"
                          >
                            <Eye size={14} />
                            View
                          </button>
                          <button
                            onClick={() => handleDownloadDocument(file)}
                            className="h-9 px-3 text-xs font-semibold text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors flex items-center gap-1"
                          >
                            <Download size={14} />
                            Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'messages' && messagingEnabled && (
          <div className="h-full min-h-0">
            <PatientMessagingView currentUser={auth.getCurrentUser()} messagingEnabled={messagingEnabled} />
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-2 pt-1.5 pb-4 z-50">
        <div className="flex max-w-md mx-auto">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center py-1.5 flex-1 transition-colors ${
              activeTab === 'home'
                ? 'text-[var(--hover-600)]'
                : 'text-gray-400 hover:text-gray-500'
            }`}
            aria-label="Home"
          >
            <Home className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-medium">Home</span>
          </button>
          
          <button
            onClick={() => setActiveTab('appointments')}
            className={`flex flex-col items-center justify-center py-1.5 flex-1 transition-colors ${
              activeTab === 'appointments'
                ? 'text-[var(--hover-600)]'
                : 'text-gray-400 hover:text-gray-500'
            }`}
            aria-label="Appointments"
          >
            <Calendar className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-medium">Appointments</span>
          </button>
          
          <button
            onClick={() => setActiveTab('records')}
            className={`flex flex-col items-center justify-center py-1.5 flex-1 transition-colors ${
              activeTab === 'records'
                ? 'text-[var(--hover-600)]'
                : 'text-gray-400 hover:text-gray-500'
            }`}
            aria-label="Records"
          >
            <FileText className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-medium">Records</span>
          </button>

          {messagingEnabled && (
            <button
              onClick={() => setActiveTab('messages')}
              className={`flex flex-col items-center justify-center py-1.5 flex-1 transition-colors ${
                activeTab === 'messages'
                  ? 'text-[var(--hover-600)]'
                  : 'text-gray-400 hover:text-gray-500'
              }`}
              aria-label="Messages"
            >
              <MessageCircle className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">Messages</span>
            </button>
          )}
          
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center justify-center py-1.5 flex-1 transition-colors ${
              activeTab === 'profile'
                ? 'text-[var(--hover-600)]'
                : 'text-gray-400 hover:text-gray-500'
            }`}
            aria-label="Profile"
          >
            <User className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-medium">Profile</span>
          </button>
        </div>
      </div>
      
      {/* Create Appointment Modal */}
      {showCreateAppointment && (
        <Modal title="Schedule New Appointment" onClose={() => setShowCreateAppointment(false)}>
          <form onSubmit={handleCreateAppointment} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Doctor (Optional)</label>
              <div className="relative" ref={doctorDropdownRef}>
                <div className="relative">
                  <input
                    type="text"
                    className="w-full border-gray-200 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 pr-10"
                    placeholder="Search doctor..."
                    value={doctorSearchQuery}
                    onChange={(e) => {
                      setDoctorSearchQuery(e.target.value);
                      setShowDoctorDropdown(true);
                    }}
                    onFocus={() => setShowDoctorDropdown(true)}
                    onBlur={() => {
                      // Delay hiding to allow click events
                      setTimeout(() => setShowDoctorDropdown(false), 200);
                    }}
                  />
                  {selectedDoctor && (
                    <button
                      type="button"
                      onClick={() => {
                        handleDoctorChange('');
                        setDoctorSearchQuery('');
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                
                {/* Dropdown */}
                {showDoctorDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 text-sm text-left hover:bg-gray-50 border-b border-gray-100"
                      onClick={() => {
                        handleDoctorChange('');
                        setDoctorSearchQuery('');
                        setShowDoctorDropdown(false);
                      }}
                    >
                      <span className="text-gray-500">No specific doctor</span>
                    </button>
                    {filteredDoctors.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500 text-center">No doctors found</div>
                    ) : (
                      filteredDoctors.map(doctor => (
                        <button
                          key={doctor.id}
                          type="button"
                          className={`w-full px-4 py-2.5 text-sm text-left hover:bg-[var(--hover-100)] ${
                            selectedDoctor === doctor.id ? 'bg-[var(--hover-100)] text-[var(--hover-600)]' : 'text-gray-700'
                          }`}
                          onClick={() => {
                            handleDoctorChange(doctor.id);
                            setDoctorSearchQuery(doctor.name);
                            setShowDoctorDropdown(false);
                          }}
                        >
                          <div className="font-medium">{doctor.name}</div>
                          {doctor.specialization && (
                            <div className="text-xs text-gray-500">{doctor.specialization}</div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Input 
                  label="Date" 
                  type="date" 
                  required 
                  value={newAppointment.date} 
                  onChange={(e: any) => handleDateChange(e.target.value)} 
                />
              </div>
              <div>
                <TimeInput
                  label="Time"
                  required 
                  value={newAppointment.time} 
                  onChange={(time) => setNewAppointment({...newAppointment, time})}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Type</label>
                <SearchableSelect
                  value={newAppointment.type || ''}
                  onChange={(selectedType) => setNewAppointment({ ...newAppointment, type: selectedType })}
                  options={treatmentTypeOptions.map((typeName) => ({ value: typeName, label: typeName }))}
                  placeholder="Select treatment type"
                  emptyMessage="No treatment type found"
                />
                {treatmentTypeOptions.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No treatment types configured by clinic yet.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Status</label>
                <select 
                  className="w-full border-gray-200 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500"
                  value={newAppointment.status} 
                  onChange={(e: any) => setNewAppointment({...newAppointment, status: e.target.value})}
                >
                  <option value="Scheduled">Scheduled</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes</label>
              <textarea 
                className="w-full border-gray-200 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
                rows={3}
                value={newAppointment.notes || ''} 
                onChange={(e: any) => setNewAppointment({...newAppointment, notes: e.target.value})}
                placeholder="Optional notes about this appointment..."
              />
            </div>
            <div className="flex flex-col gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowCreateAppointment(false)}
                className="w-full h-10 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="w-full h-12 bg-[var(--hover-600)] text-white rounded-lg hover:brightness-110 transition-all text-sm font-bold"
              >
                Schedule Appointment
              </button>
            </div>
          </form>
        </Modal>
      )}
      
      {/* Edit Profile Modal */}
      {editingProfile && (
        <Modal title="Edit Profile" onClose={() => setEditingProfile(false)}>
          <div className="space-y-4">
            <Input
              label="Name"
              value={profileChanges.name}
              onChange={(e) => setProfileChanges({...profileChanges, name: e.target.value})}
            />
            <Input
              label="Email"
              type="email"
              value={profileChanges.email}
              onChange={(e) => setProfileChanges({...profileChanges, email: e.target.value})}
            />
            <Input
              label="Phone"
              value={profileChanges.phone}
              onChange={(e) => setProfileChanges({...profileChanges, phone: e.target.value})}
            />
            <div className="flex flex-col gap-3 pt-4">
              <button
                onClick={() => setEditingProfile(false)}
                className="w-full h-10 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateProfile}
                className="w-full h-12 bg-[var(--hover-600)] text-white rounded-lg hover:brightness-110 transition-all text-sm font-bold"
              >
                Save Changes
              </button>
            </div>
          </div>
        </Modal>
      )}
      
      {/* Change Password Modal */}
      {changingPassword && (
        <Modal title="Change Password" onClose={() => setChangingPassword(false)}>
          <div className="space-y-4">
            <div className="relative">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Current Password</label>
              <input
                type={showPasswords.current ? 'text' : 'password'}
                value={passwordChange.currentPassword}
                onChange={(e) => setPasswordChange({...passwordChange, currentPassword: e.target.value})}
                className="w-full border-gray-200 border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-gray-300"
                placeholder="Enter current password"
              />
              <button
                type="button"
                className="absolute right-3 top-10 text-gray-500"
                onClick={() => setShowPasswords({...showPasswords, current: !showPasswords.current})}
              >
                {showPasswords.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            
            <div className="relative">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">New Password</label>
              <input
                type={showPasswords.new ? 'text' : 'password'}
                value={passwordChange.newPassword}
                onChange={(e) => setPasswordChange({...passwordChange, newPassword: e.target.value})}
                className="w-full border-gray-200 border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-gray-300"
                placeholder="Enter new password"
              />
              <button
                type="button"
                className="absolute right-3 top-10 text-gray-500"
                onClick={() => setShowPasswords({...showPasswords, new: !showPasswords.new})}
              >
                {showPasswords.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            
            <div className="relative">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Confirm New Password</label>
              <input
                type={showPasswords.confirm ? 'text' : 'password'}
                value={passwordChange.confirmPassword}
                onChange={(e) => setPasswordChange({...passwordChange, confirmPassword: e.target.value})}
                className="w-full border-gray-200 border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-gray-300"
                placeholder="Confirm new password"
              />
              <button
                type="button"
                className="absolute right-3 top-10 text-gray-500"
                onClick={() => setShowPasswords({...showPasswords, confirm: !showPasswords.confirm})}
              >
                {showPasswords.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            
            <div className="flex flex-col gap-3 pt-4">
              <button
                onClick={() => setChangingPassword(false)}
                className="w-full h-10 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                className="w-full h-12 bg-[var(--hover-600)] text-white rounded-lg hover:brightness-110 transition-all text-sm font-bold"
              >
                Change Password
              </button>
            </div>
          </div>
        </Modal>
      )}
      
      {/* Treatment Details Modal */}
      {showTreatmentDetails && selectedTreatmentDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-900">Treatment Details</h3>
                <button 
                  onClick={() => {
                    setShowTreatmentDetails(false);
                    setSelectedTreatmentDetails(null);
                  }}
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-medium text-gray-700 mb-2">Treatment Description</h4>
                <p className="text-gray-900">{selectedTreatmentDetails.description}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <h4 className="font-medium text-gray-700 mb-2">Date</h4>
                  <p className="text-gray-900">{new Date(selectedTreatmentDetails.date).toLocaleDateString()}</p>
                </div>
                
                <div className="bg-gray-50 rounded-xl p-4">
                  <h4 className="font-medium text-gray-700 mb-2">Cost</h4>
                  <p className="text-gray-900 font-semibold">{selectedTreatmentDetails.cost.toLocaleString()} MMK</p>
                </div>
              </div>
              
              {/* Debt Information Section */}
              <div className="grid grid-cols-1 gap-4">
                <div className={`rounded-xl p-4 ${patient.balance > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                  <h4 className="font-medium text-gray-700 mb-2">Current Debt Status</h4>
                  <p className={`font-semibold ${patient.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {patient.balance.toLocaleString()} MMK
                    {patient.balance > 0 ? ' (Outstanding Balance)' : ' (No Outstanding Balance)'}
                  </p>
                  {patient.balance > 0 && (
                    <p className="text-xs text-red-500 mt-2">
                      This is your current outstanding balance across all treatments.
                    </p>
                  )}
                </div>
                
                <div className="rounded-xl p-4 bg-blue-50 border border-blue-200">
                  <h4 className="font-medium text-gray-700 mb-2">Treatment Cost</h4>
                  <p className="font-semibold text-blue-600">
                    {selectedTreatmentDetails.cost.toLocaleString()} MMK
                  </p>
                  <p className="text-xs text-blue-500 mt-2">
                    Cost of this specific treatment: {selectedTreatmentDetails.description}
                  </p>
                </div>
              </div>
              
              {selectedTreatmentDetails.teeth && selectedTreatmentDetails.teeth.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4">
                  <h4 className="font-medium text-gray-700 mb-2">Teeth Treated</h4>
                  <p className="text-gray-900">{formatTeethWithPosition(selectedTreatmentDetails.teeth)}</p>
                </div>
              )}
              
              <div className="bg-[var(--hover-100)] rounded-xl p-4 border border-[var(--hover-200)]">
                <h4 className="font-medium text-[var(--hover-600)] mb-2 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Patient Information
                </h4>
                <p className="text-[var(--hover-600)] text-sm">
                  This treatment record is available for your reference. 
                  Contact the clinic if you have any questions about this procedure.
                </p>
              </div>
            </div>
            
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  setShowTreatmentDetails(false);
                  setSelectedTreatmentDetails(null);
                }}
                className="h-10 px-5 bg-[var(--hover-600)] text-white rounded-lg hover:brightness-110 transition-all text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Receipt Modal */}
      {showReceipt && selectedTreatment && (
        <Receipt
          patient={patient}
          treatments={[selectedTreatment]}
          currency={currency}
          appName={appName}
          receiptIdentity={receiptIdentity}
          receiptSize={receiptSize}
          onClose={() => setShowReceipt(false)}
        />
      )}

      {/* Document Viewer Modal */}
      {showDocumentViewer && selectedDocument && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowDocumentViewer(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-[var(--hover-600)]" />
                <div>
                  <h3 className="font-semibold text-gray-900">{selectedDocument.name}</h3>
                  <p className="text-xs text-gray-500">{selectedDocument.type || 'File'} � {formatBytes(selectedDocument.size)}</p>
                </div>
              </div>
              <button
                onClick={() => setShowDocumentViewer(false)}
                className="p-2 text-gray-500 hover:bg-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Document Preview */}
            <div className="p-6 overflow-auto" style={{ maxHeight: 'calc(90vh - 180px)' }}>
              {/* Image Preview */}
              {(selectedDocument.type?.startsWith('image/') || selectedDocument.name.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) && (
                <div className="flex items-center justify-center bg-gray-50 rounded-xl p-4">
                  <img
                    src={selectedDocument.url}
                    alt={selectedDocument.name}
                    className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-sm"
                  />
                </div>
              )}

              {/* PDF Preview */}
              {(selectedDocument.type === 'application/pdf' || selectedDocument.name.endsWith('.pdf')) && (
                <div className="rounded-xl overflow-hidden border border-gray-200">
                  <iframe
                    src={selectedDocument.url}
                    title={selectedDocument.name}
                    className="w-full"
                    style={{ height: '60vh' }}
                  />
                </div>
              )}

              {/* Video Preview */}
              {(selectedDocument.type?.startsWith('video/') || selectedDocument.name.match(/\.(mp4|webm|ogg|mov)$/i)) && (
                <div className="flex items-center justify-center bg-gray-50 rounded-xl p-4">
                  <video
                    src={selectedDocument.url}
                    controls
                    className="max-w-full max-h-[60vh] rounded-lg"
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              )}

              {/* Unsupported File Type */}
              {!selectedDocument.type?.startsWith('image/') && 
               !selectedDocument.type?.startsWith('video/') && 
               selectedDocument.type !== 'application/pdf' &&
               !selectedDocument.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|pdf|mp4|webm|ogg|mov)$/i) && (
                <div className="text-center py-12">
                  <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Preview Not Available</h3>
                  <p className="text-gray-500 text-sm mb-6">This file type cannot be previewed. Please download to view.</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
              <button
                onClick={() => setShowDocumentViewer(false)}
                className="h-10 px-5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                Close
              </button>
              <a
                href={selectedDocument.url}
                download={selectedDocument.name}
                className="h-10 flex items-center gap-2 px-5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
              >
                <Download size={16} />
                Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDashboard;

