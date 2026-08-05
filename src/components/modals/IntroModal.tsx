// The explainer dialog: a few screens, a figure and a paragraph each, dots and
// Back/Next along the bottom.
//
// Navigation only; every word lives in data/*Intro.ts. Built on the shared
// Modal rather than a hand-rolled backdrop, so it inherits the same panel,
// animation, Escape handling and footer rail as every other dialog.
//
// Generic over its steps because there are two of these now -- "How profiles
// work", shown once to an empty workspace, and "About cookie-sets", opened from
// the Cookies tab -- and they differ only in their copy and their last button.
import {useState} from 'react';
import {ArrowLeft, ArrowRight, ImageIcon} from 'lucide-react';
import {Modal} from '../ui/Modal';
import type {ReactNode} from 'react';
import type {IntroStep} from '../../data/profileIntro';

export function IntroModal({steps, onClose, finishLabel, onFinish}: {
  steps: IntroStep[];
  onClose: () => void;
  // The last step's button. Omit both this and onFinish for an explainer that
  // has nowhere to send the reader; the button then just closes.
  finishLabel?: ReactNode;
  // Called instead of a bare close on the last step, so "Create a profile"
  // lands on the dialog it just described rather than back on the empty screen
  // the reader was already looking at.
  onFinish?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = index === steps.length - 1;

  return (
    <Modal
      className="intro-modal"
      onClose={onClose}
      title={step.title}
      subtitle={`Step ${index + 1} of ${steps.length}`}
      footer={
        <>
          <div className="intro-dots" aria-hidden="true">
            {steps.map((item, dot) => (
              <span className={dot === index ? 'active' : ''} key={item.figure} />
            ))}
          </div>
          {index > 0 && (
            <button className="ghost" onClick={() => setIndex(index - 1)} type="button">
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <button
            onClick={() => {
              if (!last) {
                setIndex(index + 1);
                return;
              }
              (onFinish || onClose)();
            }}
            type="button"
          >
            {last ? finishLabel || 'Got it' : <>Next <ArrowRight size={16} /></>}
          </button>
        </>
      }
    >
      <div className="intro-body">
        {/* The frame is 16:10 whether or not a screenshot exists yet, so a step
          * that has one and a step that does not sit at the same height in the
          * same dialog and Next never shifts the text under it. A shot is
          * letterboxed inside it rather than cropped to fit: these are pictures
          * of a UI, and cutting the edge off a dialog to make it 16:10 would
          * take the thing being pointed at with it.
          * The caption sits under the frame in both cases. It used to be inside
          * the placeholder, which is fine for a label on an empty box and wrong
          * for one on a picture. */}
        <figure className="intro-figure">
          <div
            className={step.image ? 'intro-figure-frame has-shot' : 'intro-figure-frame'}
            data-figure={step.figure}
          >
            {step.image ?
              <img alt="" src={step.image} /> :
              <ImageIcon size={22} />}
          </div>
          <figcaption>{step.caption}</figcaption>
        </figure>
        <p>{step.body}</p>
      </div>
    </Modal>
  );
}
