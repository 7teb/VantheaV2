import "./Hero.css";

const wordmark = "VantheaX";

export const Hero = () => (
  <div className="hero-stage">
    <h1 className="hero steel" data-text={wordmark}>
      {wordmark}
    </h1>
  </div>
);
