import { FlexLayout, Orientation, QLabel, QSlider, QWidget } from "@nodegui/nodegui";

export interface SliderConfig {
	label: string;
	min: number;
	max: number;
	/** Resolution of the slider in real units. */
	step: number;
	value?: number;
	/** Text for the value readout. Default: value with decimals matching step, plus unit. */
	format?: (value: number) => string;
	unit?: string;
	/** Width of the name label in px so stacked sliders line up. */
	labelWidth?: number;
}

/**
 * Labelled floating-point slider: "Name  [=====o-----]  1.25 x".
 * QSlider is integer-only, so values are mapped onto integer steps.
 */
export default class SliderWidget extends QWidget {
	private slider: QSlider;
	private nameLabel: QLabel;
	private valueLabel: QLabel;
	private cfg: Required<Omit<SliderConfig, "format">> & Pick<SliderConfig, "format">;
	private listeners: ((value: number) => void)[] = [];
	private current: number;

	constructor(config: SliderConfig) {
		super();
		this.cfg = { value: config.min, unit: "", labelWidth: 90, ...config };
		this.current = this.cfg.value;
		this.setObjectName("slider-widget");

		const layout = new FlexLayout();
		this.setLayout(layout);

		this.nameLabel = new QLabel();
		this.nameLabel.setObjectName("slider-name");
		this.nameLabel.setText(this.cfg.label);
		this.nameLabel.setFixedWidth(this.cfg.labelWidth);
		layout.addWidget(this.nameLabel);

		this.slider = new QSlider();
		this.slider.setObjectName("slider-bar");
		this.slider.setOrientation(Orientation.Horizontal);
		layout.addWidget(this.slider);

		this.valueLabel = new QLabel();
		this.valueLabel.setObjectName("slider-value");
		this.valueLabel.setFixedWidth(90);
		layout.addWidget(this.valueLabel);

		this.slider.addEventListener("valueChanged", (i) => {
			this.current = this.fromTicks(i);
			this.refreshLabel();
			for (const l of this.listeners) l(this.current);
		});

		this.applyRange();

		this.setStyleSheet(`
			#slider-widget { flex-direction: row; margin-top: 4px; height: 24px; }
			#slider-bar { flex: 1; }
			#slider-value { qproperty-alignment: 'AlignRight | AlignVCenter'; }
		`);
	}

	/** Called with the new value whenever it changes (by the user or setValue). */
	onChange(listener: (value: number) => void): void {
		this.listeners.push(listener);
	}

	get value(): number {
		return this.current;
	}

	setValue(value: number): void {
		this.slider.setValue(this.toTicks(value));
		this.current = this.fromTicks(this.slider.value());
		this.refreshLabel();
	}

	/** Changes the range, keeping the current value (clamped). */
	setRange(min: number, max: number, step = this.cfg.step): void {
		const keep = this.current;
		Object.assign(this.cfg, { min, max, step });
		this.applyRange(keep);
	}

	setLabel(label: string): void {
		this.cfg.label = label;
		this.nameLabel.setText(label);
	}

	private applyRange(value = this.current): void {
		const ticks = Math.max(1, Math.round((this.cfg.max - this.cfg.min) / this.cfg.step));
		this.slider.setRange(0, ticks);
		this.slider.setSingleStep(1);
		this.slider.setPageStep(Math.max(1, Math.round(ticks / 10)));
		this.setValue(value);
	}

	private toTicks(v: number): number {
		const clamped = Math.min(this.cfg.max, Math.max(this.cfg.min, v));
		return Math.round((clamped - this.cfg.min) / this.cfg.step);
	}

	private fromTicks(i: number): number {
		// The last tick is exactly max, even if max isn't a multiple of step.
		if (i >= Math.round((this.cfg.max - this.cfg.min) / this.cfg.step)) return this.cfg.max;
		return this.cfg.min + i * this.cfg.step;
	}

	private refreshLabel(): void {
		const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(this.cfg.step) + 1e-9)));
		const text = this.cfg.format
			? this.cfg.format(this.current)
			: this.current.toFixed(decimals) + (this.cfg.unit ? ` ${this.cfg.unit}` : "");
		this.valueLabel.setText(text);
	}
}
