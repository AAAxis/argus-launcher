// "How profiles work" -- three screens, shown once to a workspace that has none.
//
// Navigation only; the copy is in data/profileIntro.ts. Built on the shared
// Modal rather than a hand-rolled backdrop, so it inherits the same panel,
// animation, Escape handling and footer rail as every other dialog.
import {useState} from 'react';
import {ArrowLeft, ArrowRight, ImageIcon} from 'lucide-react';
import {Modal} from '../ui/Modal';
import {PROFILE_INTRO_STEPS} from '../../data/profileIntro';

export function ProfileIntroModal({onClose, onCreateProfile}: {
  onClose: () => void;
  // Called instead of a bare close when the last step's button is pressed, so
  // "Create a profile" lands on the dialog it just described rather than back
  // on the empty screen the user was already looking at.
  onCreateProfile: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = PROFILE_INTRO_STEPS[index];
  const last = index === PROFILE_INTRO_STEPS.length - 1;

  return (
    <Modal
      className="intro-modal"
      onClose={onClose}
      title={step.title}
      subtitle={`Step ${index + 1} of ${PROFILE_INTRO_STEPS.length}`}
      footer={
        <>
          <div className="intro-dots" aria-hidden="true">
            {PROFILE_INTRO_STEPS.map((item, dot) => (
              <span className={dot === index ? 'active' : ''} key={item.figure} />
            ))}
          </div>
          {index > 0 && (
            <button className="ghost" onClick={() => setIndex(index - 1)} type="button">
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <button
            onClick={() => (last ? onCreateProfile() : setIndex(index + 1))}
            type="button"
          >
            {last ? 'Create a profile' : <>Next <ArrowRight size={16} /></>}
          </button>
        </>
      }
    >
      <div className="intro-body">
        {/* Reserved at 16:10 so the real screenshots drop in without moving the
          * text under them. Until they exist it says so, rather than showing a
          * blank rectangle that reads as a failed image load. */}
        <div className="intro-figure" data-figure={step.figure}>
          <ImageIcon size={22} />
          <span>{step.caption}</span>
        </div>
        <p>{step.body}</p>
      </div>
    </Modal>
  );
}
