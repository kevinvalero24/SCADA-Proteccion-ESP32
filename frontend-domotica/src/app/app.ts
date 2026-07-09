import { Component, OnInit, AfterViewInit, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TelemetriaService } from './services/telemetria';
import { Chart, registerables } from 'chart.js';
import { io } from 'socket.io-client'; // <-- NUEVA ANTENA DE RADIO

Chart.register(...registerables);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, AfterViewInit {
  datoActual: any = {}; 
  graficaCarga: any;
  esFormato24h: boolean = true; 
  historialCompleto: any[] = []; 

  alarmaActiva: boolean = false;
  mensajeAlarma: string = 'Sistema Energizado y en Línea';
  conexionPerdida: boolean = false;

  // =========================================================
  // ---> CEREBRO HMI BIDIRECCIONAL (WEBSOCKETS) <---
  // =========================================================
  socket: any;
  estadoMando: any = { 
    modo: 'manual', 
    forzar_rele: true, 
    hora_inicio: '', 
    hora_fin: '' 
  };

  @ViewChild('graficaConsumo') canvasLienzo!: ElementRef;

  constructor(
    private telemetriaService: TelemetriaService,
    private cdr: ChangeDetectorRef 
  ) {}

  ngOnInit() {
    this.conectarRadioSCADA(); // Iniciamos el túnel en tiempo real
    this.leerTablero();
    setInterval(() => { this.leerTablero(); }, 3000);
  }

  // Sincronización instantánea con Node.js
  conectarRadioSCADA() {
    // Nos conectamos al puerto 3000 del backend
    this.socket = io('http://localhost:3000'); 

    // Cuando Node.js nos mande una actualización, la reflejamos en los botones
    this.socket.on('estado_mando', (estadoActualizado: any) => {
      this.estadoMando = estadoActualizado;
      this.cdr.detectChanges(); 
    });
  }

  // Funciones de Mando del Operador
  cambiarModo(nuevoModo: string) {
    this.estadoMando.modo = nuevoModo;
    this.socket.emit('comando_operador', this.estadoMando);
  }

  enviarComandoManual(estado: boolean) {
    this.estadoMando.forzar_rele = estado;
    this.socket.emit('comando_operador', this.estadoMando);
  }

  actualizarHorario(tipo: string, event: any) {
    if (tipo === 'inicio') this.estadoMando.hora_inicio = event.target.value;
    if (tipo === 'fin') this.estadoMando.hora_fin = event.target.value;
    this.socket.emit('comando_operador', this.estadoMando);
  }
  // =========================================================

  ngAfterViewInit() { this.inicializarGrafica(); }

  inicializarGrafica() {
    if (this.canvasLienzo) {
      this.graficaCarga = new Chart(this.canvasLienzo.nativeElement, {
        type: 'line',
        data: {
          labels: [], 
          datasets: [{
            label: 'Consumo de Potencia (W)',
            data: [],
            borderColor: '#ffc107', 
            backgroundColor: 'rgba(255, 193, 7, 0.1)', 
            borderWidth: 2, fill: true, tension: 0.4 
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false, 
          scales: {
            x: { display: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8892b0', maxTicksLimit: 8 } },
            y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8892b0' } }
          }
        }
      });
    }
  }

  toggleFormatoHora(event: any) {
    this.esFormato24h = event.target.checked; 
    this.leerTablero(); 
  }

  leerTablero() {
    this.telemetriaService.obtenerDatosReales().subscribe({
      next: (datos: any) => {
        if (datos && datos.length > 0) {
          const datosOrdenados = datos.sort((a: any, b: any) => (a._id > b._id ? 1 : -1));
          this.historialCompleto = datosOrdenados; 
          this.datoActual = datosOrdenados[datosOrdenados.length - 1]; 
          
          if (this.datoActual.timestamp) {
            const tiempoDelDato = new Date(this.datoActual.timestamp).getTime();
            const tiempoActual = new Date().getTime();
            const diferenciaSegundos = (tiempoActual - tiempoDelDato) / 1000;

            if (diferenciaSegundos > 15) {
              this.conexionPerdida = true;
              this.alarmaActiva = false;
              this.mensajeAlarma = '¡PÉRDIDA DE SEÑAL DE TELEMETRÍA!';
            } else {
              this.conexionPerdida = false;
              
              if (this.datoActual.sensor_error === true || this.datoActual.sensor_error === 'true') {
                this.alarmaActiva = true;
                this.mensajeAlarma = '¡FALLA CRÍTICA: PÉRDIDA DE SEÑAL DEL SENSOR PZEM!';
              } else if (this.datoActual.alarm_state === true || this.datoActual.alarm_state === 'true') {
                this.alarmaActiva = true;
                this.mensajeAlarma = '¡FALLA: PROTECCIÓN DISPARADA DESDE EL HARDWARE!';
              } else {
                this.alarmaActiva = false;
                this.mensajeAlarma = 'Sistema Energizado y en Línea';
              }
            }
          }

          if (this.graficaCarga) {
            const historialReciente = datosOrdenados.slice(-20);
            this.graficaCarga.data.labels = historialReciente.map((d: any) => {
              if (d.timestamp) {
                return new Date(d.timestamp).toLocaleTimeString('es-CO', { 
                  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !this.esFormato24h
                });
              }
              return '';
            });
            this.graficaCarga.data.datasets[0].data = historialReciente.map((d: any) => d.power);
            
            if (this.conexionPerdida) {
              this.graficaCarga.data.datasets[0].borderColor = '#6c757d'; 
              this.graficaCarga.data.datasets[0].backgroundColor = 'rgba(108, 117, 125, 0.1)';
            } else {
              this.graficaCarga.data.datasets[0].borderColor = this.alarmaActiva ? '#dc3545' : '#ffc107';
              this.graficaCarga.data.datasets[0].backgroundColor = this.alarmaActiva ? 'rgba(220, 53, 69, 0.1)' : 'rgba(255, 193, 7, 0.1)';
            }
            this.graficaCarga.update(); 
          }
          this.cdr.detectChanges();
        }
      },
      error: (error: any) => { console.error('Falla en base de datos:', error); }
    });
  }

  descargarReporte() {
    if (this.historialCompleto.length === 0) return;
    let contenidoCSV = "sep=;\nFecha;Hora;Voltaje (V);Corriente (A);Potencia (W)\n";
    const formatearDecimal = (valor: any): string => {
      if (valor === undefined || valor === null) return '0';
      return valor.toString().replace('.', ','); 
    };
    this.historialCompleto.forEach(dato => {
      if (dato.timestamp) {
        const fechaObj = new Date(dato.timestamp);
        contenidoCSV += `${fechaObj.toLocaleDateString('es-CO')};${fechaObj.toLocaleTimeString('es-CO', { hour12: false })};${formatearDecimal(dato.voltage)};${formatearDecimal(dato.current)};${formatearDecimal(dato.power)}\n`;
      }
    });
    const blob = new Blob(["\ufeff" + contenidoCSV], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const enlaceDescarga = document.createElement('a');
    enlaceDescarga.href = url;
    enlaceDescarga.download = `Reporte_Carga_${new Date().getTime()}.csv`; 
    enlaceDescarga.click();
    window.URL.revokeObjectURL(url);
  }
}