import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; 

import { TelemetriaService } from './services/telemetria';
import { NodoService } from './services/nodo';
import { AlertaService } from './services/alerta'; 
import { Chart, registerables } from 'chart.js';
import { io } from 'socket.io-client'; 
import { AuthService } from './services/auth';
import { LoginComponent } from './components/login/login';

Chart.register(...registerables);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, LoginComponent, FormsModule], 
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewInit, OnDestroy {
  datoActual: any = {};
  graficaCarga: any;
  esFormato24h: boolean = true;
  cantidadDecimales: number = 2;
  historialCompleto: any[] = [];

  alarmaActiva: boolean = false;
  mensajeAlarma: string = 'Sistema Energizado y en Línea';
  conexionPerdida: boolean = false;
  menuReporteAbierto: boolean = false;

  listaNodos: any[] = [];
  mostrarPanelConfig: boolean = false;
  historialAlertas: any[] = [];
  mostrarPanelAlertas: boolean = false;

  metricasEnergia: any = { 
    hoy: { energia_kwh: 0, costo_cop: 0 },
    semana: { energia_kwh: 0, costo_cop: 0 },
    mes: { energia_kwh: 0, costo_cop: 0 }
  };

  // ---> SEGURIDAD: TIMEOUT DE INACTIVIDAD <---
  timeoutId: any;
  tiempoInactividad: number = 10 * 60 * 1000; // 10 minutos en milisegundos

  @ViewChild('graficaConsumo') canvasLienzo!: ElementRef;
  @ViewChild('graficaVoltaje') canvasVoltaje!: ElementRef;
  @ViewChild('graficaCorriente') canvasCorriente!: ElementRef;
  @ViewChild('graficaPotencia') canvasPotencia!: ElementRef;

  gaugeVoltaje: any;
  gaugeCorriente: any;
  gaugePotencia: any;

  // ---> VARIABLES PARA EL TEMPORIZADOR GUIADO <---
  mensajeHorario: string = '';
  subModoHorario: string = 'rango'; // 'encendido', 'apagado' o 'rango'
  
  socket: any;
  estadoMando: any = {
    modo: 'manual',
    forzar_rele: true,
    hora_inicio: '',
    hora_fin: '',
  };

  constructor(
    private telemetriaService: TelemetriaService,
    private cdr: ChangeDetectorRef,
    public authService: AuthService,
    private nodoService: NodoService,
    private alertaService: AlertaService 
  ) {}

  // =========================================================
  // ---> SEGURIDAD Y CIERRE DE SESIÓN <---
  // =========================================================
  cerrarSesionTerminal() {
    this.limpiarEventosInactividad();
    this.authService.logout();
    window.location.reload();
  }

  resetTimer = () => {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.authService.estaAutenticado()) {
      this.timeoutId = setTimeout(() => this.cerrarSesionPorInactividad(), this.tiempoInactividad);
    }
  };

  iniciarTemporizadorInactividad() {
    this.resetTimer();
    window.addEventListener('mousemove', this.resetTimer);
    window.addEventListener('click', this.resetTimer);
    window.addEventListener('keypress', this.resetTimer);
    window.addEventListener('scroll', this.resetTimer);
  }

  limpiarEventosInactividad() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    window.removeEventListener('mousemove', this.resetTimer);
    window.removeEventListener('click', this.resetTimer);
    window.removeEventListener('keypress', this.resetTimer);
    window.removeEventListener('scroll', this.resetTimer);
  }

  cerrarSesionPorInactividad() {
    if (this.authService.estaAutenticado()) {
      alert('⏱️ La sesión ha caducado por inactividad. Por seguridad, debe ingresar nuevamente a su hogar domótico.');
      this.cerrarSesionTerminal();
    }
  }

  // =========================================================
  // ---> CICLO DE VIDA DE ANGULAR <---
  // =========================================================
  ngOnInit() {
    this.conectarRadioSCADA(); 
    this.leerTarjetasEnVivo();
    this.leerGraficaHistorica();
    
    setInterval(() => { this.leerTarjetasEnVivo(); }, 5000);
    setInterval(() => { this.leerGraficaHistorica(); }, 60000);

    this.iniciarTemporizadorInactividad();
  }

  ngOnDestroy() {
    this.limpiarEventosInactividad();
  }

  toggleMenuReporte() {
    this.menuReporteAbierto = !this.menuReporteAbierto;
  }

  descargarReporteMensual(tipo: string) {
    this.menuReporteAbierto = false; 
    const url = this.telemetriaService.exportarHistorialCSV(tipo);
    window.open(url, '_blank');
  }

  // =========================================================
  // ---> COMUNICACIÓN WEBSOCKET Y COMANDOS DE DOMÓTICA <---
  // =========================================================
  conectarRadioSCADA() {
    this.socket = io('http://localhost:3000');
    this.socket.on('estado_mando', (estadoActualizado: any) => {
      this.estadoMando = estadoActualizado;
      this.cdr.detectChanges();
    });
  }

  cambiarModo(nuevoModo: string) {
    this.estadoMando.modo = nuevoModo;
    if (nuevoModo === 'manual') {
      this.mensajeHorario = ''; 
    }
    this.socket.emit('comando_operador', this.estadoMando);
  }

  enviarComandoManual(estado: boolean) {
    this.estadoMando.forzar_rele = estado;
    this.socket.emit('comando_operador', this.estadoMando);
  }

  // ---> NUEVA LÓGICA: FILTROS DE SUB-MENÚ DE HORARIO <---
  cambiarSubModoHorario(subModo: string) {
    this.subModoHorario = subModo;
    // Limpieza de seguridad: si cambiamos de menú, borramos las horas previas
    this.estadoMando.hora_inicio = '';
    this.estadoMando.hora_fin = '';
    this.mensajeHorario = '';
  }

  programarHorario() {
    // Validaciones estrictas dependiendo de la pestaña en la que estemos
    if (this.subModoHorario === 'encendido' && !this.estadoMando.hora_inicio) {
      alert('Por favor seleccione la hora a la que desea encender el circuito.'); return;
    }
    if (this.subModoHorario === 'apagado' && !this.estadoMando.hora_fin) {
      alert('Por favor seleccione la hora a la que desea apagar el circuito.'); return;
    }
    if (this.subModoHorario === 'rango' && (!this.estadoMando.hora_inicio || !this.estadoMando.hora_fin)) {
      alert('Por favor seleccione la hora de encendido y apagado para fijar el rango.'); return;
    }
    
    // Enviamos el dato limpio
    this.socket.emit('comando_operador', this.estadoMando);
    
    // Generamos el mensaje al usuario
    if (this.subModoHorario === 'encendido') {
      this.mensajeHorario = `PROGRAMADO: Se encenderá automáticamente a las ${this.estadoMando.hora_inicio}`;
    } else if (this.subModoHorario === 'apagado') {
      this.mensajeHorario = `PROGRAMADO: Se apagará automáticamente a las ${this.estadoMando.hora_fin}`;
    } else {
      this.mensajeHorario = `PROGRAMADO: ON a las ${this.estadoMando.hora_inicio} | OFF a las ${this.estadoMando.hora_fin}`;
    }
  }

  // =========================================================
  // ---> MÓDULOS DE CONFIGURACIÓN Y ALERTAS <---
  // =========================================================
  abrirPanelConfiguracion() {
    this.mostrarPanelConfig = !this.mostrarPanelConfig;
    if (this.mostrarPanelConfig) {
      this.mostrarPanelAlertas = false; 
      this.nodoService.obtenerNodos().subscribe({
        next: (res) => this.listaNodos = res,
        error: (err) => console.error('Error', err)
      });
    }
  }

  guardarNuevoUmbral(idNodo: string, idCircuito: string, valorInput: string) {
    const watts = Number(valorInput);
    this.nodoService.actualizarUmbral(idNodo, idCircuito, watts).subscribe({
      next: (res) => {
        alert(`¡Configuración exitosa! Límite actualizado a ${watts}W.`);
        this.nodoService.obtenerNodos().subscribe(data => this.listaNodos = data);
      },
      error: (err) => {
        console.error(err);
        alert('Falla al reconfigurar.');
      }
    });
  }

  abrirPanelAlertas() {
    this.mostrarPanelAlertas = !this.mostrarPanelAlertas;
    if (this.mostrarPanelAlertas) {
      this.mostrarPanelConfig = false; 
      this.alertaService.obtenerHistorial().subscribe({
        next: (res) => this.historialAlertas = res,
        error: (err) => console.error('Error', err)
      });
    }
  }

  // =========================================================
  // ---> GRÁFICAS Y VELOCÍMETROS <---
  // =========================================================
  ngAfterViewInit() {
    this.inicializarGrafica(); 
    this.inicializarVelocimetros(); 
  }

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
            borderWidth: 2,
            fill: true,
            tension: 0.4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: {
            x: { display: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8892b0', maxTicksLimit: 8 } },
            y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8892b0' } },
          },
        },
      });
    }
  }

  inicializarVelocimetros() {
    const opcionesComunes = (color: string) => ({
      responsive: true, maintainAspectRatio: false, circumference: 180, rotation: 270,      
      plugins: { legend: { display: false }, tooltip: { enabled: false } }, cutout: '75%'       
    });
    if (this.canvasVoltaje) {
      this.gaugeVoltaje = new Chart(this.canvasVoltaje.nativeElement, {
        type: 'doughnut', data: { datasets: [{ data: [0, 150], backgroundColor: ['#ffc107', 'rgba(255,255,255,0.05)'], borderWidth: 0 }] }, options: opcionesComunes('#ffc107')
      });
    }
    if (this.canvasCorriente) {
      this.gaugeCorriente = new Chart(this.canvasCorriente.nativeElement, {
        type: 'doughnut', data: { datasets: [{ data: [0, 5], backgroundColor: ['#0dcaf0', 'rgba(255,255,255,0.05)'], borderWidth: 0 }] }, options: opcionesComunes('#0dcaf0')
      });
    }
    if (this.canvasPotencia) {
      this.gaugePotencia = new Chart(this.canvasPotencia.nativeElement, {
        type: 'doughnut', data: { datasets: [{ data: [0, 1200], backgroundColor: ['#198754', 'rgba(255,255,255,0.05)'], borderWidth: 0 }] }, options: opcionesComunes('#198754')
      });
    }
  }

  actualizarArcoGauge(chart: any, valor: number, maximo: number) {
    if (chart) {
      const valorLimpio = valor > maximo ? maximo : (valor < 0 ? 0 : valor);
      chart.data.datasets[0].data = [valorLimpio, maximo - valorLimpio];
      chart.update();
    }
  }

  toggleFormatoHora(event: any) {
    this.esFormato24h = event.target.checked;
    this.leerGraficaHistorica(); 
  }

  leerTarjetasEnVivo() {
    this.telemetriaService.obtenerDatosEnVivo().subscribe({
      next: (datoRapido: any) => {
        if (datoRapido) {
          this.datoActual = datoRapido;
          this.actualizarArcoGauge(this.gaugeVoltaje, Number(this.datoActual.voltage || 0), 150);
          this.actualizarArcoGauge(this.gaugeCorriente, Number(this.datoActual.current || 0), 5); 
          this.actualizarArcoGauge(this.gaugePotencia, Number(this.datoActual.power || 0), 1200); 

          if (this.datoActual.timestamp) {
            const tiempoDelDato = new Date(this.datoActual.timestamp).getTime();
            const tiempoActual = new Date().getTime();
            const diferenciaSegundos = (tiempoActual - tiempoDelDato) / 1000;

            if (diferenciaSegundos > 20) {
              this.conexionPerdida = true;
              this.alarmaActiva = false;
              this.mensajeAlarma = '¡SIN CONEXIÓN CON EL MEDIDOR!';
            } else {
              this.conexionPerdida = false;
              if (this.datoActual.sensor_error === true || this.datoActual.sensor_error === 'true') {
                this.alarmaActiva = true;
                this.mensajeAlarma = '¡ERROR EN EL SENSOR DEL CIRCUITO!';
              } else if (this.datoActual.alarm_state === true || this.datoActual.alarm_state === 'true') {
                this.alarmaActiva = true;
                this.mensajeAlarma = '¡PROTECCIÓN DISPARADA! CIRCUITO APAGADO';
              } else {
                this.alarmaActiva = false;
                this.mensajeAlarma = 'Hogar Inteligente en Línea';
              }
            }
          }
          this.cdr.detectChanges();
        }
      },
      error: (err: any) => console.error('Falla RAM:', err)
    });
  }

  leerGraficaHistorica() {
    this.telemetriaService.obtenerDatosReales().subscribe({
      next: (datos: any) => {
        if (datos && datos.length > 0) {
          const datosOrdenados = datos.sort((a: any, b: any) => (a._id > b._id ? 1 : -1));
          this.historialCompleto = datosOrdenados;
          if (this.graficaCarga) {
            const historialReciente = datosOrdenados.slice(-20);
            this.graficaCarga.data.labels = historialReciente.map((d: any) => {
              if (d.timestamp) {
                return new Date(d.timestamp).toLocaleTimeString('es-CO', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !this.esFormato24h,
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
      error: (error: any) => console.error('Falla BD:', error),
    });

    this.telemetriaService.obtenerMetricas().subscribe({
      next: (res: any) => {
        this.metricasEnergia = res;
        this.cdr.detectChanges();
      },
      error: (err: any) => console.error('Error Métricas', err)
    });
  }
}