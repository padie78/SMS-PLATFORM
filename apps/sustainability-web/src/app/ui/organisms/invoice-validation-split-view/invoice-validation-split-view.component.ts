import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  input,
  output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as pdfjs from 'pdfjs-dist';
import type { InvoiceFieldGeometry } from '@sms/common';

export type InvoiceFieldHighlight = {
  readonly fieldKey: string;
  readonly geometry?: InvoiceFieldGeometry;
  readonly confidenceLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
};

@Component({
  selector: 'app-invoice-validation-split-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-validation-split-view.component.html',
  styleUrl: './invoice-validation-split-view.component.css'
})
export class InvoiceValidationSplitViewComponent implements OnInit, OnDestroy {
  readonly pdfFile = input<File | null>(null);
  readonly highlights = input<ReadonlyArray<InvoiceFieldHighlight>>([]);
  readonly activeField = input<string | null>(null);

  readonly fieldHover = output<string>();
  readonly fieldFocus = output<string>();

  @ViewChild('pdfCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly renderWidth = signal(0);
  readonly renderHeight = signal(0);
  readonly loadError = signal<string | null>(null);

  private pdfDoc: pdfjs.PDFDocumentProxy | null = null;
  private blobUrl: string | null = null;

  constructor() {
    effect(() => {
      const file = this.pdfFile();
      if (file) {
        void this.loadPdf(file);
      }
    });
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined' && window.pdfWorkerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = window.pdfWorkerSrc;
    }
  }

  ngOnDestroy(): void {
    void this.pdfDoc?.destroy();
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
    }
  }

  onFieldEnter(fieldKey: string): void {
    this.fieldHover.emit(fieldKey);
  }

  onFieldLeave(): void {
    this.fieldHover.emit('');
  }

  boxStyle(h: InvoiceFieldHighlight): Record<string, string> {
    const g = h.geometry;
    if (!g?.boundingBox) {
      return { display: 'none' };
    }
    const { left, top, width, height } = g.boundingBox;
    const level = h.confidenceLevel ?? 'MEDIUM';
    const color =
      level === 'LOW' ? 'rgba(239,68,68,0.35)' : level === 'HIGH' ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.35)';
    const border =
      level === 'LOW' ? '#ef4444' : level === 'HIGH' ? '#22c55e' : '#eab308';
    const active = this.activeField() === h.fieldKey;
    return {
      left: `${left * 100}%`,
      top: `${top * 100}%`,
      width: `${width * 100}%`,
      height: `${height * 100}%`,
      background: color,
      border: `2px solid ${border}`,
      boxShadow: active ? `0 0 0 3px ${border}` : 'none'
    };
  }

  private async loadPdf(file: File): Promise<void> {
    this.loadError.set(null);
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
    }
    this.blobUrl = URL.createObjectURL(file);
    try {
      const loading = pdfjs.getDocument({ url: this.blobUrl });
      this.pdfDoc = await loading.promise;
      await this.renderPage(1);
    } catch {
      this.loadError.set('No se pudo renderizar el PDF.');
    }
  }

  private async renderPage(pageNumber: number): Promise<void> {
    if (!this.pdfDoc) return;
    const page = await this.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    this.renderWidth.set(viewport.width);
    this.renderHeight.set(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
}

declare global {
  interface Window {
    pdfWorkerSrc?: string;
  }
}
