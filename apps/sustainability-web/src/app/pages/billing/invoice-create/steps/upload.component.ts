import { Component, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { FileUploadModule } from 'primeng/fileupload';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';

import { InvoiceStateService } from '../../../../services/state/invoice-state.service';
import { AuthService } from '../../../../services/infrastructure/auth.service';
import { NotificationService } from '../../../../services/ui/notification.service';
import { InvoiceOnboardingUiService } from '../../../../features/invoice-onboarding/services/invoice-onboarding-ui.service';

@Component({
  selector: 'app-invoice-upload',
  standalone: true,
  imports: [CommonModule, FileUploadModule, ButtonModule, ToastModule],
  templateUrl: './upload.component.html',
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
    `
  ]
})
export class InvoiceUploadComponent implements OnInit {
  private readonly stateService = inject(InvoiceStateService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  readonly onboarding = inject(InvoiceOnboardingUiService);

  @Output() readonly onComplete = new EventEmitter<void>();

  isLoading = false;
  selectedFile: File | null = null;

  async ngOnInit(): Promise<void> {
    await this.auth.ensureSession();
    const saved = this.stateService.getSnapshot();
    this.selectedFile = saved.file;
  }

  onFileSelect(event: { files?: File[] }): void {
    const file = event.files?.[0];
    if (file) {
      this.selectedFile = file;
      this.notifications.show('info', 'Archivo seleccionado', file.name);
    }
  }

  onFormSubmit(event: Event): void {
    event.preventDefault();
    void this.processAndContinue();
  }

  async processAndContinue(): Promise<void> {
    if (!this.selectedFile) {
      return;
    }

    this.isLoading = true;

    try {
      await this.onboarding.runPostUploadPipeline(this.selectedFile);
      this.notifications.success('Documento registrado', 'Procesando extracción…');
      this.onComplete.emit();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      this.notifications.error('Error de proceso', message);
    } finally {
      this.isLoading = false;
    }
  }
}
